import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { Authority } from '../src/authority.ts';
import { games } from '../src/registry.ts';
import { createApi } from '../src/server.ts';
import { AccessControl, newAccessToken, tokenHash } from '../src/access-control.ts';
import { RequestBudget, validateJsonBudget, securityLogger } from '../src/http-security.ts';

const admin='coordinator-security-test-credential';
async function fixture(sharing=true,ratePolicy={}){
  const dir=mkdtempSync(join(tmpdir(),'coop-security-policy-')),usersFile=join(dir,'users.json');
  const auditor=newAccessToken(),operator=newAccessToken();
  const users={version:1,users:[{id:'reviewer',role:'auditor',tokenHash:tokenHash(auditor),disabled:false},
    {id:'tester',role:'operator',tokenHash:tokenHash(operator),disabled:false}]};
  const save=()=>writeFileSync(usersFile,JSON.stringify(users));save();
  const authority=new Authority(':memory:',games,'security-policy');
  const log=join(dir,'audit.jsonl');
  const app=createApi(authority,admin,{access:new AccessControl({usersFile,...(sharing?{trustedProxyOrigin:'https://board.example.ts.net'}:{})}),ratePolicy,audit:securityLogger(log)});
  await new Promise<void>(resolve=>app.listen(0,'127.0.0.1',resolve));const port=(app.address() as any).port;
  const call=(path:string,token='',body?:unknown,headers:Record<string,string>={})=>new Promise<any>((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port,path,method:body===undefined?'GET':'POST',headers:{Host:sharing?'board.example.ts.net':`127.0.0.1:${port}`,
      ...(token?{Authorization:`Bearer ${token}`}:{ }),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{
      let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,body:JSON.parse(text)}));
    });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  return {authority,call,port,auditor,operator,users,save,log,close:async()=>{app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));authority.close();}};
}

test('shared access: individual permissions, historical-only auditor, attribution, live revocation and no master Host bypass',async()=>{
  const f=await fixture();try{
    assert.equal((await f.call('/api/v1/identity',f.auditor)).body.role,'auditor');
    for(const Host of ['board.example.ts.net',`127.0.0.1:${f.port}`,`localhost:${f.port}`]){
      assert.equal((await f.call('/api/v1/rollouts',admin,undefined,{Host})).status,403);
    }
    const config={gameId:'take-time',playerCount:3,scenarioId:'official-clock-1-1'};
    assert.equal((await f.call('/api/v1/episodes',f.auditor,config)).status,403);
    const creation=await f.call('/api/v1/episodes',f.operator,config);assert.equal(creation.status,201);
    const id=creation.body.episodeId;
    assert.equal((await f.call(`/api/v1/rollouts/${id}`,f.auditor)).status,403);
    assert.equal((await f.call(`/api/v1/rollouts/${id}`,f.operator)).status,200);
    assert.equal((await f.call(`/api/v1/episodes/${id}/truncate`,f.auditor,{reason:'not allowed'})).status,403);
    assert.equal((await f.call(`/api/v1/episodes/${id}/truncate`,f.operator,{reason:'bounded test'})).status,200);
    assert.equal((await f.call(`/api/v1/rollouts/${id}`,f.auditor)).status,200);
    const note=await f.call(`/api/v1/rollouts/${id}/annotations`,f.auditor,{kind:'review',text:'Checked visible evidence.'});
    assert.equal(note.status,201);assert.equal(note.body.source,'coordinator:reviewer');
    assert.equal((await f.call(`/api/v1/rollouts/${id}/annotations`,f.auditor,{kind:'reflection',text:'Impersonating a player.'})).status,403);
    for(const operation of ['audit','training','replay'])assert.equal((await f.call(`/api/v1/episodes/${id}/${operation}`,f.auditor)).status,403);
    f.users.users[0].disabled=true;f.save();
    assert.equal((await f.call('/api/v1/rollouts',f.auditor)).status,401);
    assert.equal((await f.call('/api/v1/rollouts',f.operator)).status,200);
    const logged=readFileSync(f.log,'utf8');
    for(const secret of [admin,f.auditor,f.operator,...creation.body.seats.map((s:any)=>s.token),'Checked visible evidence.'])assert.ok(!logged.includes(secret));
    const events=logged.trim().split('\n').map(line=>JSON.parse(line));
    assert.ok(events.some(e=>e.principal==='tester'&&e.endpoint==='episode:create'&&e.status===201));
    assert.ok(events.some(e=>e.principal==='reviewer'&&e.endpoint==='rollout:annotate'&&e.status===201));
  }finally{await f.close();}
});

test('shared access: forwarded identity/Host cannot grant privileges or cross origins',async()=>{
  const f=await fixture();try{
    const spoof={'X-Forwarded-For':'127.0.0.1','X-Forwarded-Host':'board.example.ts.net','Tailscale-User-Login':'owner@example.com'};
    assert.equal((await f.call('/api/v1/rollouts','',undefined,spoof)).status,401);
    assert.equal((await f.call('/api/v1/rollouts',f.operator,undefined,{...spoof,Host:'board.example.ts.net.evil.test'})).status,403);
    assert.equal((await f.call('/api/v1/rollouts',f.operator,undefined,{Origin:'https://evil.test'})).status,403);
    const okay=await f.call('/api/v1/rollouts',f.operator,undefined,{Origin:'https://board.example.ts.net'});
    assert.equal(okay.status,200);assert.equal(okay.headers['strict-transport-security'],'max-age=31536000');
  }finally{await f.close();}
});

test('HTTP rate limits remain effective when forwarded IPs are rotated; independent credentials get their own budget',async()=>{
  const f=await fixture(false,{credentialBurst:2,credentialPerMinute:0.01});try{
    assert.equal((await f.call('/api/v1/rollouts',f.operator)).status,200);
    assert.equal((await f.call('/api/v1/rollouts',f.operator)).status,200);
    const denied=await f.call('/api/v1/rollouts',f.operator,undefined,{'X-Forwarded-For':'8.8.8.8'});
    assert.equal(denied.status,429);assert.equal(denied.headers['retry-after'],'5');
    assert.equal((await f.call('/api/v1/rollouts',f.auditor)).status,200);
  }finally{await f.close();}
});

test('global rate limit bounds rotating bearer strings, and time refills request budgets',async()=>{
  let now=0;const budget=new RequestBudget({globalBurst:2,globalPerMinute:60},()=>now);
  budget.global();budget.global();assert.throws(()=>budget.global(),/rate exceeded/);now=1000;budget.global();
  const f=await fixture(false,{globalBurst:2,globalPerMinute:0.01});try{
    assert.equal((await f.call('/api/v1/health',newAccessToken())).status,200);
    assert.equal((await f.call('/api/v1/health',newAccessToken())).status,200);
    assert.equal((await f.call('/api/v1/health',newAccessToken())).status,429);
  }finally{await f.close();}
});

test('JSON pre-validation bounds depth, breadth, reserved keys and non-finite numbers',()=>{
  validateJsonBudget({action:{type:'speak',text:'constructor is allowed as a string'}});
  for(const text of ['{"x":1e400}','{"__proto__":{"polluted":true}}','{"action":{"constructor":{}}}'])assert.throws(()=>validateJsonBudget(JSON.parse(text)));
  assert.throws(()=>validateJsonBudget(JSON.parse('['.repeat(33)+'0'+']'.repeat(33))),/complexity/);
  assert.throws(()=>validateJsonBudget(Array(8193).fill(0)),/complexity/);
});

test('rotating unknown credentials cannot fill the rate map and lock out a new identity',()=>{
  let now=0;const budget=new RequestBudget({},()=>now);
  for(let i=0;i<1300;i++){now+=100;budget.global();budget.credential(`unknown-${i}`);}
  budget.global();assert.doesNotThrow(()=>budget.credential('legitimate-new-colleague'));
  assert.ok((budget as any).buckets.size<=1024);
});

test('base64 coordinator credentials work; malformed configured credentials fail at startup',async()=>{
  const a=new Authority(':memory:',games,'base64-security-test'),token='base64-coordinator-credential+/==';
  const app=createApi(a,token);try{
    assert.throws(()=>createApi(a,'unsupported credential with spaces'),/Bearer-compatible/);
    await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));
    const response=await fetch(`http://127.0.0.1:${(app.address() as any).port}/identity`,{headers:{Authorization:`Bearer ${token}`}});
    assert.equal(response.status,200);assert.equal((await response.json()).role,'coordinator');
  }finally{app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));a.close();}
});
