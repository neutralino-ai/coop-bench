import {readFileSync,writeFileSync} from 'node:fs';
import {request} from 'node:http';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const data=join(root,'data','local-server');
const connection=JSON.parse(readFileSync(join(data,'connection.json'),'utf8'));
const out=process.argv[2];
async function call(path,headers={}){
  return new Promise((resolve,reject)=>{
    const req=request(new URL(path,connection.baseUrl),{headers},res=>{
      let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));
    });req.on('error',reject);req.setTimeout(10000,()=>req.destroy(Error('Timeout')));req.end();
  });
}
const checks=[];
async function check(name,path,headers,expected){const result=await call(path,headers);checks.push({name,status:result.status,expected,passed:result.status===expected});return result;}
const health=await check('health','/health',{},200);
const games=await check('registered-games','/api/v1/games',{},200);
await check('foreign-host-blocked','/health',{Host:'desktop501.neutrinophysics.cn:8788'},403);
await check('foreign-origin-blocked','/health',{Origin:'https://example.org'},403);
await check('localhost-alias','/health',{Host:`localhost:${new URL(connection.baseUrl).port}`},200);
if(out){
  const meta=JSON.parse(readFileSync(join(out,'episode.json'),'utf8'));
  const seat=JSON.parse(readFileSync(join(out,'p1','seat.json'),'utf8'));
  await check('anonymous-observation-denied',`/api/v1/episodes/${meta.episodeId}/observation`,{},401);
  await check('seat-cannot-get-full-audit',`/api/v1/episodes/${meta.episodeId}/audit`,{Authorization:`Bearer ${seat.seatToken}`},401);
}
const report={checkedAt:new Date().toISOString(),baseUrl:connection.baseUrl,pid:connection.pid,build:health.body.build,games:games.body.games.map(g=>({id:g.id,scenarioCount:g.scenarios.length})),checks,allPassed:checks.every(c=>c.passed)};
if(out)writeFileSync(join(out,'server-checks.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(!report.allPassed)process.exitCode=1;
