import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { AccessControl, tokenHash, type AccessUsers } from '../src/access-control.ts';
import { HumanAuth, HUMAN_SESSION_SECONDS, type HumanAuthOptions } from '../src/human-auth.ts';
import { Authority } from '../src/authority.ts';
import { createApi, startLocalApp } from '../src/server.ts';
import { games } from '../src/registry.ts';

const ADMIN='synthetic-master-credential-AAAAAAAAA',OWNER='synthetic-owner-credential-AAAAAAAAAA',READER='synthetic-auditor-credential-AAAAAAAA';
const PASSWORD='Synthetic test password 7!',NEXT='Synthetic replacement password 8!';
const highRates={globalBurst:1000,globalPerMinute:1000,userBurst:1000,userPerMinute:1000};
function cleanup(dir:string){for(const name of readdirSync(dir)){const path=join(dir,name);if(statSync(path).isFile())unlinkSync(path);}rmdirSync(dir);}
async function fixture(t:any,options:HumanAuthOptions={}){
  const dir=mkdtempSync(join(tmpdir(),'coop-human-auth-test-')),file=join(dir,'access-users.json'),dbPath=join(dir,'human-auth.sqlite');
  const users:AccessUsers={version:1,users:[{id:'owner',role:'operator',tokenHash:tokenHash(OWNER),disabled:false},{id:'reader',role:'auditor',tokenHash:tokenHash(READER),disabled:false}]};
  const write=()=>writeFileSync(file,JSON.stringify(users),{mode:0o600});write();
  const access=new AccessControl({usersFile:file,trustedProxyOrigin:'https://api.example.test'});
  const auth=new HumanAuth(dbPath,access,{rate:highRates,...options}),authority=new Authority(':memory:',games,'human-auth-fixture');
  const audit:any[]=[];
  const server=createApi(authority,ADMIN,{access,humanAuth:auth,serveWeb:false,audit:e=>audit.push(e),ratePolicy:{globalBurst:1000,globalPerMinute:1000,credentialBurst:1000,credentialPerMinute:1000,heavyBurst:1000,heavyPerMinute:1000}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api/v1`;
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await auth.close();authority.close();cleanup(dir);});
  const request=async(path:string,token?:string,payload?:unknown,headers:Record<string,string>={})=>{
    const response=await fetch(base+path,{method:payload===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(payload===undefined?{}:{'Content-Type':'application/json'}),...headers},...(payload===undefined?{}:{body:typeof payload==='string'?payload:JSON.stringify(payload)})});
    const text=await response.text();return {status:response.status,headers:response.headers,text,data:JSON.parse(text)};
  };
  return {dir,file,dbPath,users,write,access,auth,authority,audit,request};
}

test('password initialization needs an existing individual credential; public status never enumerates accounts',async t=>{
  const f=await fixture(t),status=await f.request('/auth/status');
  assert.equal(status.status,200);assert.deepEqual(Object.keys(status.data).sort(),['enabled','passwordLoginAvailable','passwordPolicy','sessionTtlSeconds']);assert.equal(status.data.enabled,true);assert.doesNotMatch(status.text,/owner|reader|configured/i);
  for(const token of [undefined,ADMIN,'wrong-personal-token-AAAAAAAAAAAA'])assert.notEqual((await f.request('/auth/password',token,{password:PASSWORD})).status,200);
  const before=await f.request('/auth/account',OWNER);assert.equal(before.data.passwordConfigured,false);assert.equal(before.data.authentication,'personal-token');
  const created=await f.request('/auth/password',OWNER,{password:PASSWORD});assert.equal(created.status,200,created.text);assert.match(created.data.token,/^hs1_[A-Za-z0-9_-]{43}$/);assert.equal(created.data.identity.id,'owner');assert.equal(created.data.passwordConfigured,true);
  const account=await f.request('/auth/account',created.data.token);assert.equal(account.data.authentication,'password-session');assert.equal(account.data.sessionExpiresAt,created.data.expiresAt);assert.equal(account.data.passwordConfigured,true);
  const identity=await f.request('/identity',created.data.token);assert.equal(identity.status,200);assert.equal(identity.data.id,'owner');assert.equal(identity.data.role,'operator');assert.equal((await f.request('/identity',OWNER)).status,200);
  assert.equal((await f.request('/auth/password',OWNER,{password:NEXT})).status,401);assert.equal((await f.request('/auth/password',created.data.token,{password:NEXT,currentPassword:'wrong password'})).status,401);
});

test('login error body is identical for nonexistent, disabled, expired, unconfigured and wrong-password accounts',async t=>{
  const f=await fixture(t);await f.auth.setPassword(OWNER,ADMIN,{password:PASSWORD});
  const wrong=await f.request('/auth/login',undefined,{userId:'owner',password:NEXT});assert.equal(wrong.status,401);
  const cases=['missing-user','reader'];
  for(const id of cases){const r=await f.request('/auth/login',undefined,{userId:id,password:PASSWORD});assert.equal(r.status,401);assert.equal(r.text,wrong.text);}
  f.users.users[0].disabled=true;f.write();assert.equal((await f.request('/auth/login',undefined,{userId:'owner',password:PASSWORD})).text,wrong.text);
  f.users.users[0].disabled=false;f.users.users[0].expiresAt=new Date(Date.now()-1000).toISOString();f.write();assert.equal((await f.request('/auth/login',undefined,{userId:'owner',password:PASSWORD})).text,wrong.text);
  assert.doesNotMatch(wrong.text,/owner|password 7|missing-user/);
});

test('only salted scrypt hashes and token digests persist; sessions survive reopening the separate private database',async t=>{
  const f=await fixture(t),one=await f.auth.setPassword(OWNER,ADMIN,{password:PASSWORD}),two=await f.auth.setPassword(READER,ADMIN,{password:PASSWORD});
  const db=new DatabaseSync(f.dbPath,{readOnly:true});
  const rows=db.prepare('SELECT * FROM passwords ORDER BY user_id').all();assert.equal(rows.length,2);assert.equal(rows[0].kdf_n,65536);assert.equal(rows[0].kdf_r,8);assert.equal(rows[0].kdf_p,2);assert.notDeepEqual(rows[0].salt,rows[1].salt);assert.notDeepEqual(rows[0].password_hash,rows[1].password_hash);
  const sessions=db.prepare('SELECT token_hash FROM sessions').all();assert.ok(sessions.every(row=>/^[a-f0-9]{64}$/.test(String(row.token_hash))));db.close();
  const raw=readFileSync(f.dbPath);for(const secret of [PASSWORD,one.token,two.token,OWNER,READER])assert.equal(raw.includes(Buffer.from(secret)),false);
  if(process.platform!=='win32')assert.equal(statSync(f.dbPath).mode&0o777,0o600);
  await f.auth.close();const reopened=new HumanAuth(f.dbPath,f.access);try{assert.equal(reopened.authorize(one.token,ADMIN,'rollout:read')?.id,'owner');assert.equal(reopened.account(two.token,ADMIN).role,'auditor');}finally{await reopened.close();}
  assert.equal(f.authority.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('passwords','sessions')").get()!.n,0);
});

test('session expiry is seven days or earlier account expiry and session authorization reloads role/revocation immediately',async t=>{
  let now=Date.now();const f=await fixture(t,{now:()=>now}),first=await f.auth.setPassword(OWNER,ADMIN,{password:PASSWORD});
  assert.equal(Date.parse(first.expiresAt),now+HUMAN_SESSION_SECONDS*1000);
  assert.equal(f.auth.authorize(first.token,ADMIN,'episode:create')?.role,'operator');
  f.users.users[0].role='auditor';f.write();assert.equal(f.auth.authorize(first.token,ADMIN,'rollout:read')?.role,'auditor');assert.throws(()=>f.auth.authorize(first.token,ADMIN,'episode:create'),{code:'FORBIDDEN'});
  f.users.users[0].disabled=true;f.write();assert.throws(()=>f.auth.authorize(first.token,ADMIN,'rollout:read'),{code:'UNAUTHORIZED'});
  f.users.users[0].disabled=false;f.users.users[0].expiresAt=new Date(now+60000).toISOString();f.write();const short=await f.auth.login({userId:'owner',password:PASSWORD});assert.equal(Date.parse(short.expiresAt),now+60000);
  now+=60000;assert.throws(()=>f.auth.authorize(short.token,ADMIN,'rollout:read'),{code:'UNAUTHORIZED'});
  delete f.users.users[0].expiresAt;f.write();now=Date.parse(first.expiresAt);assert.throws(()=>f.auth.authorize(first.token,ADMIN,'rollout:read'),{code:'UNAUTHORIZED'});
});

test('password change checks current password, revokes all previous sessions and returns one replacement session',async t=>{
  const f=await fixture(t),first=await f.auth.setPassword(OWNER,ADMIN,{password:PASSWORD}),second=await f.auth.login({userId:'owner',password:PASSWORD});
  const changed=await f.request('/auth/password',second.token,{password:NEXT,currentPassword:PASSWORD});assert.equal(changed.status,200,changed.text);
  for(const token of [first.token,second.token])assert.equal((await f.request('/identity',token)).status,401);
  assert.equal((await f.request('/identity',changed.data.token)).status,200);assert.equal((await f.request('/identity',OWNER)).status,200);
  await assert.rejects(f.auth.login({userId:'owner',password:PASSWORD}),{code:'UNAUTHORIZED'});assert.equal((await f.auth.login({userId:'owner',password:NEXT})).identity.id,'owner');
  const peer=await f.auth.login({userId:'owner',password:NEXT});assert.equal((await f.request('/auth/logout',changed.data.token,{})).status,200);assert.equal((await f.request('/identity',changed.data.token)).status,401);assert.equal((await f.request('/identity',peer.token)).status,200);
  assert.equal((await f.request('/auth/logout',OWNER,{})).status,200);assert.equal((await f.request('/identity',OWNER)).status,200);
});

test('rotating or deleting an access identity invalidates password enrollment and old sessions',async t=>{
  const f=await fixture(t),old=await f.auth.setPassword(OWNER,ADMIN,{password:PASSWORD});
  const rotated='synthetic-rotated-owner-credential-AAAA';f.users.users[0].tokenHash=tokenHash(rotated);f.write();
  assert.throws(()=>f.auth.authorize(old.token,ADMIN,'rollout:read'),{code:'UNAUTHORIZED'});await assert.rejects(f.auth.login({userId:'owner',password:PASSWORD}),{code:'UNAUTHORIZED'});assert.equal(f.auth.account(rotated,ADMIN).passwordConfigured,false);
  const replacement=await f.auth.setPassword(rotated,ADMIN,{password:NEXT});assert.equal(f.auth.authorize(replacement.token,ADMIN,'rollout:read')?.id,'owner');
  f.users.users.splice(0,1);f.write();assert.throws(()=>f.auth.authorize(replacement.token,ADMIN,'rollout:read'),{code:'UNAUTHORIZED'});
});

test('concurrent first password setup has one winner and does not overwrite its password/session',async t=>{
  const f=await fixture(t),results=await Promise.allSettled([f.auth.setPassword(OWNER,ADMIN,{password:PASSWORD}),f.auth.setPassword(OWNER,ADMIN,{password:NEXT})]);
  const successes=results.filter(result=>result.status==='fulfilled');assert.equal(successes.length,1);
  const failure=results.find(result=>result.status==='rejected') as PromiseRejectedResult;assert.equal(failure.reason.code,'AUTH_CONFLICT');
  const winner=(successes[0] as PromiseFulfilledResult<any>).value;assert.equal(f.auth.authorize(winner.token,ADMIN,'rollout:read')?.id,'owner');
  const selected=results[0].status==='fulfilled'?PASSWORD:NEXT,rejected=selected===PASSWORD?NEXT:PASSWORD;
  assert.equal((await f.auth.login({userId:'owner',password:selected})).identity.id,'owner');await assert.rejects(f.auth.login({userId:'owner',password:rejected}),{code:'UNAUTHORIZED'});
});

test('a delayed old-password login cannot mint a fresh session after a password change',async t=>{
  const f=await fixture(t);await f.auth.setPassword(OWNER,ADMIN,{password:PASSWORD});
  const queue=(f.auth as any).queue,derive=queue.derive.bind(queue);let arrived!:()=>void,release!:()=>void;
  const arrival=new Promise<void>(resolve=>{arrived=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  queue.derive=async(...args:any[])=>{const result=await derive(...args);arrived();await gate;return result;};
  const stale=f.auth.login({userId:'owner',password:PASSWORD});await arrival;queue.derive=derive;
  const changed=await f.auth.setPassword(OWNER,ADMIN,{password:NEXT,currentPassword:PASSWORD});release();
  await assert.rejects(stale,{code:'UNAUTHORIZED'});assert.equal(f.auth.authorize(changed.token,ADMIN,'rollout:read')?.id,'owner');
});

test('revocation during async password hashing prevents the pending write from committing',async t=>{
  const f=await fixture(t),attempt=f.auth.setPassword(OWNER,ADMIN,{password:PASSWORD});
  f.users.users[0].disabled=true;f.write();await assert.rejects(attempt,{code:'UNAUTHORIZED'});
  f.users.users[0].disabled=false;f.write();assert.equal(f.auth.account(OWNER,ADMIN).passwordConfigured,false);
});

test('a preexisting personal token with the new session prefix remains a personal credential',async t=>{
  const f=await fixture(t),prefixed='hs1_'+ 'A'.repeat(43);f.users.users[0].tokenHash=tokenHash(prefixed);f.write();
  assert.equal((await f.request('/identity',prefixed)).status,200);assert.equal(f.auth.account(prefixed,ADMIN).authentication,'personal-token');
  assert.deepEqual(f.auth.logout(prefixed,ADMIN),{loggedOut:true});assert.equal((await f.request('/identity',prefixed)).status,200);
  const session=await f.auth.setPassword(prefixed,ADMIN,{password:PASSWORD});assert.equal(f.auth.account(session.token,ADMIN).authentication,'password-session');
});

test('password/login validation and existing HTTP limits reject malformed, oversized and hostile-origin requests',async t=>{
  const f=await fixture(t);
  for(const input of [null,[],{}, {password:'short'}, {password:' '.repeat(20)}, {password:'a'.repeat(129)}, {password:'😀'.repeat(129)}, {password:PASSWORD,extra:true}])assert.equal((await f.request('/auth/password',OWNER,input)).status,400);
  for(const input of [{userId:'owner',password:''},{userId:'x'.repeat(65),password:PASSWORD},{userId:'owner',password:'a'.repeat(129)},{userId:'owner',password:PASSWORD,extra:true}])assert.equal((await f.request('/auth/login',undefined,input)).status,400);
  assert.equal((await f.request('/auth/login',undefined,'{not-json')).status,400);
  assert.equal((await f.request('/auth/login',undefined,{userId:'owner',password:'a'.repeat(65536)})).status,413);
  assert.equal((await f.request('/auth/password',OWNER,{password:PASSWORD},{Origin:'https://hostile.example.test'})).status,403);
  const valid=await f.auth.setPassword(OWNER,ADMIN,{password:PASSWORD});assert.equal((await f.request('/auth/account',valid.token)).status,200);
  const logs=JSON.stringify(f.audit);for(const secret of [PASSWORD,valid.token,OWNER])assert.equal(logs.includes(secret),false);
});

test('authentication rate limits and KDF queue remain bounded for arbitrary unknown users',async t=>{
  const f=await fixture(t,{rate:{globalBurst:3,globalPerMinute:1,userBurst:2,userPerMinute:1}});
  for(let i=0;i<2;i++)await assert.rejects(f.auth.login({userId:'missing',password:PASSWORD}),{code:'UNAUTHORIZED'});
  await assert.rejects(f.auth.login({userId:'missing',password:PASSWORD}),{code:'RATE_LIMITED'});await assert.rejects(f.auth.login({userId:'different',password:PASSWORD}),{code:'RATE_LIMITED'});
});

test('more than two running plus four queued KDF jobs are rejected, and shutdown drains jobs without SQLite-after-close errors',async t=>{
  const f=await fixture(t),jobs=Array.from({length:10},(_,i)=>f.auth.login({userId:`missing-${i}`,password:PASSWORD}));
  const resultsPromise=Promise.allSettled(jobs);await f.auth.close();const results=await resultsPromise;
  assert.ok(results.every(result=>result.status==='rejected'));assert.equal(results.filter(result=>result.status==='rejected'&&result.reason.code==='RATE_LIMITED').length,4);
  assert.ok(results.every(result=>result.status==='rejected'&&!/database|sqlite|password 7!/i.test(result.reason.message)));
});

test('human sessions keep human role limits and cannot enter agent seats; seat API tokens remain unchanged',async t=>{
  const f=await fixture(t),session=await f.auth.setPassword(OWNER,ADMIN,{password:PASSWORD});
  const created=await f.request('/episodes',session.token,{gameId:'hanabi',playerCount:3,scenarioId:'base'});assert.equal(created.status,201,created.text);
  const episode=created.data.episodeId,seat=created.data.seats[0].token;
  assert.equal((await f.request(`/episodes/${episode}/observation`,seat)).status,200);assert.equal((await f.request(`/episodes/${episode}/observation`,session.token)).status,401);
  assert.equal((await f.request('/auth/account',seat)).status,401);assert.equal((await f.request('/auth/password',seat,{password:NEXT})).status,401);
  f.users.users[0].role='auditor';f.write();assert.equal((await f.request('/episodes',session.token,{gameId:'hanabi',playerCount:3,scenarioId:'base'})).status,403);
});

test('startLocalApp owns separate auth lifecycle while local-only coordinator and unavailable status remain compatible',async()=>{
  const localDir=mkdtempSync(join(tmpdir(),'coop-human-auth-local-'));const local=await startLocalApp({dataDir:localDir,port:0});
  try{
    const status=await (await fetch(local.apiUrl+'/auth/status')).json();assert.equal(status.enabled,false);assert.equal(existsSync(join(localDir,'human-auth.sqlite')),false);
    const identity=await fetch(local.apiUrl+'/identity',{headers:{Authorization:`Bearer ${local.adminToken}`}});assert.equal(identity.status,200);
    const setup=await fetch(local.apiUrl+'/auth/password',{method:'POST',headers:{Authorization:`Bearer ${local.adminToken}`,'Content-Type':'application/json'},body:JSON.stringify({password:PASSWORD})});assert.equal(setup.status,403);
  }finally{await local.close();cleanup(localDir);}
  const sharedDir=mkdtempSync(join(tmpdir(),'coop-human-auth-owned-'));writeFileSync(join(sharedDir,'access-users.json'),JSON.stringify({version:1,users:[{id:'owner',role:'operator',disabled:false,tokenHash:tokenHash(OWNER)}]}));
  let running=await startLocalApp({dataDir:sharedDir,port:0,trustedProxyOrigin:'https://api.example.test'});let token='';
  try{
    const r=await fetch(running.apiUrl+'/auth/password',{method:'POST',headers:{Authorization:`Bearer ${OWNER}`,'Content-Type':'application/json'},body:JSON.stringify({password:PASSWORD})});assert.equal(r.status,200);token=(await r.json()).token;
    await running.close();running=await startLocalApp({dataDir:sharedDir,port:0,trustedProxyOrigin:'https://api.example.test'});
    assert.equal((await fetch(running.apiUrl+'/identity',{headers:{Authorization:`Bearer ${token}`}})).status,200);
  }finally{await running.close();cleanup(sharedDir);}
});
