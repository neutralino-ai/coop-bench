// Bounded negative-access checks against the explicitly authorized new endpoint.
import assert from 'node:assert/strict';
import {request} from 'node:https';
import {writeFileSync,mkdirSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
const report={at:new Date().toISOString(),port:34936,checks:[]};
function raw(path,options={}){return new Promise((resolve,reject)=>{
 const body=options.body;
 const req=request({hostname:'coop.neutrinophysics.cn',servername:'coop.neutrinophysics.cn',port:34936,path,method:body===undefined?'GET':'POST',timeout:10000,
  headers:{...(body===undefined?{}:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}),...options.headers}},res=>{
  const chunks=[];let n=0;res.on('data',c=>{n+=c.length;if(n>128*1024)res.destroy(Error('Response budget'));else chunks.push(c);});res.on('error',reject);
  res.on('end',()=>resolve({status:res.statusCode,tlsVerified:req.socket?.authorized,headers:res.headers,bytes:Buffer.concat(chunks)}));
 });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Timeout')));req.end(body);
});}
async function expect(name,path,status,options){await delay(150);const result=await raw(path,options);report.checks.push({name,status:result.status,expected:status,passed:result.status===status});assert.equal(result.status,status,name);return result;}
try{
 const h=await expect('public health','/api/v1/health',200);assert.equal(h.tlsVerified,true);report.tlsVerified=true;
 for(const path of ['/api/v1/identity','/api/v1/rooms','/api/v1/rollouts'])await expect('anonymous private data denied',path,401);
 await expect('forged forwarding headers do not authenticate','/api/v1/identity',401,{headers:{'X-Forwarded-For':'127.0.0.1','X-Forwarded-Host':'localhost:8789','Tailscale-User-Login':'owner'}});
 await expect('wrong host denied','/api/v1/health',421,{headers:{Host:'invalid.example:34936'}});
 for(const Origin of ['https://invalid.example','null','https://coop.neutrinophysics.cn:34936'])await expect('browser origin denied','/api/v1/health',403,{headers:{Origin}});
 for(const path of ['/','/play','/app.js','/api/health','/health','/api/v1/','/api/v1//health','/api/v1/%68ealth','/api/v1/games/../health','/api/v1/health/'])await expect('noncanonical or UI route denied',path,404);
 await expect('unauthorized room mutation denied','/api/v1/rooms',401,{body:JSON.stringify({gameId:'hanabi',playerCount:3,scenarioId:'base'})});
 await expect('oversized request denied','/api/v1/episodes',413,{body:JSON.stringify({data:'x'.repeat(66000)})});
 report.allPassed=true;
}catch(error){report.allPassed=false;report.error=String(error.message).slice(0,150);process.exitCode=1;}
mkdirSync('artifacts/cloud-v09',{recursive:true});writeFileSync('artifacts/cloud-v09/access-boundaries.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({allPassed:report.allPassed,checks:report.checks.length,tlsVerified:report.tlsVerified,error:report.error}));
