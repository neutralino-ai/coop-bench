import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AccessControl, newAccessToken, readAccessUsers, tokenHash, validateAccessUsers } from '../src/access-control.ts';
import type { AccessUsers } from '../src/access-control.ts';

const admin='coordinator-secret-for-tests-123456789';
const proxy='https://desktop501.example-tailnet.ts.net';
const request=(host='localhost:8788',origin?:string,peer='127.0.0.1',extra={})=>({headers:{host,...(origin===undefined?{}:{origin}),...extra},socket:{remoteAddress:peer}} as any);
const denied=(f:()=>unknown,code='FORBIDDEN')=>assert.throws(f,(e:any)=>e.code===code);

test('local boundary rejects external peers, rebinding and forged proxy headers',()=>{
  const access=new AccessControl();
  assert.equal(access.assertRequest(request(),8788),'local');
  assert.equal(access.assertRequest(request('localhost:8788','http://127.0.0.1:8788','::ffff:127.0.0.1'),8788),'local');
  for(const peer of ['192.168.1.9','100.64.0.9','2001:db8::9','::ffff:192.168.1.9',''])denied(()=>access.assertRequest(request('localhost:8788',undefined,peer,{'x-forwarded-for':'127.0.0.1'}),8788));
  for(const host of ['attacker.test:8788','localhost:8788.evil.test','localhost','127.0.0.1:80','desktop501.example-tailnet.ts.net'])denied(()=>access.assertRequest(request(host,undefined,'127.0.0.1',{'x-forwarded-host':'localhost:8788'}),8788));
  for(const origin of ['null','http://evil.test','http://localhost:8788/path','http://localhost:8788/','http://localhost:8788@evil.test','http://localhost:8788.evil.test'])denied(()=>access.assertRequest(request('localhost:8788',origin),8788));
});

test('private proxy opt-in requires one exact HTTPS origin and retains loopback peer boundary',()=>{
  const access=new AccessControl({trustedProxyOrigin:proxy});
  assert.equal(access.assertRequest(request(new URL(proxy).host,proxy),8788),'proxy');
  assert.equal(access.assertRequest(request(new URL(proxy).host),8788),'proxy');
  assert.equal(access.assertRequest(request(),8788),'local');
  for(const origin of ['https://evil.test',proxy+'/',proxy+'.evil.test','http://desktop501.example-tailnet.ts.net','http://localhost:8788'])denied(()=>access.assertRequest(request(new URL(proxy).host,origin),8788));
  for(const host of ['desktop501.example-tailnet.ts.net.evil.test','other.example-tailnet.ts.net','desktop501.example-tailnet.ts.net:443'])denied(()=>access.assertRequest(request(host,proxy),8788));
  denied(()=>access.assertRequest(request(new URL(proxy).host,proxy,'100.64.0.5'),8788));
  for(const origin of ['https://*.example.ts.net','http://desktop501.example-tailnet.ts.net',proxy+'/',proxy+':443',proxy+'/path',proxy+'?a=1',proxy+'#fragment','https://u:p@desktop501.example-tailnet.ts.net'])denied(()=>new AccessControl({trustedProxyOrigin:origin}),'INVALID_CONFIG');
});

test('cloud proxy accepts one canonical HTTPS DNS name without expanding its trust boundary',()=>{
  const origin='https://boardgames.example.com',access=new AccessControl({trustedProxyOrigin:origin});
  assert.equal(access.assertRequest(request('boardgames.example.com',origin),8788),'proxy');
  for(const host of ['boardgames.example.com.evil.test','evil.example.com','boardgames.example.com:443'])denied(()=>access.assertRequest(request(host,origin),8788));
  denied(()=>access.assertRequest(request('boardgames.example.com','https://evil.example.com'),8788));
  denied(()=>access.assertRequest(request('boardgames.example.com',origin,'203.0.113.5',{'x-forwarded-for':'127.0.0.1'}),8788));
  for(const bad of ['https://127.0.0.1','https://[::1]','https://localhost','https://example.com.','https://EXAMPLE.com','https://example.com:8443','https://a..example.com','https://-a.example.com','https://example.123','https://'+('a'.repeat(64))+'.com'])denied(()=>new AccessControl({trustedProxyOrigin:bad}),'INVALID_CONFIG');
});

test('sharing disables master credential regardless of spoofed local Host classification',()=>{
  const access=new AccessControl({trustedProxyOrigin:proxy});
  for(const host of ['localhost:8788','127.0.0.1:8788',new URL(proxy).host]){
    access.assertRequest(request(host),8788);
    denied(()=>access.authorize(admin,admin,'rollout:read'));
    denied(()=>access.authorize(admin,admin,'episode:create'));
  }
  assert.equal(access.sharingEnabled,true);
  assert.equal(new AccessControl().authorize(admin,admin,'episode:create').role,'coordinator');
});

test('separate auditor/operator permissions, expiry, revocation and digest-only storage',()=>{
  const dir=mkdtempSync(join(tmpdir(),'coop-security-access-')),file=join(dir,'users.json');
  const alice=newAccessToken(),bob=newAccessToken();
  const config:AccessUsers={version:1,users:[
    {id:'alice',role:'auditor',tokenHash:tokenHash(alice),disabled:false},
    {id:'bob',role:'operator',tokenHash:tokenHash(bob),disabled:false,expiresAt:new Date(Date.now()+3600000).toISOString()}
  ]};
  const write=()=>writeFileSync(file,JSON.stringify(config));write();
  const access=new AccessControl({usersFile:file});
  assert.equal(readFileSync(file,'utf8').includes(alice),false);assert.equal(alice.length,43);
  assert.deepEqual(access.authorize(alice,admin,'rollout:read'),{id:'alice',role:'auditor',source:'alice'});
  assert.equal(access.authorize(alice,admin,'rollout:annotate').id,'alice');
  for(const permission of ['episode:create','episode:truncate','episode:export','episode:replay'] as const){
    denied(()=>access.authorize(alice,admin,permission));assert.equal(access.authorize(bob,admin,permission).id,'bob');
  }
  config.users[0].disabled=true;write();denied(()=>access.authorize(alice,admin,'rollout:read'),'UNAUTHORIZED');
  config.users[1].expiresAt=new Date(Date.now()-1000).toISOString();write();denied(()=>access.authorize(bob,admin,'rollout:read'),'UNAUTHORIZED');
  assert.equal(access.authorize(admin,admin,'episode:create').role,'coordinator');
  for(const bad of ['',alice+'x','attacker-controlled-credential','x'.repeat(257)])denied(()=>access.authorize(bad,admin,'rollout:read'),'UNAUTHORIZED');
  unlinkSync(file);rmdirSync(dir);
});

test('malformed user files fail closed without exposing secrets; valid config loads live',()=>{
  const dir=mkdtempSync(join(tmpdir(),'coop-security-invalid-')),file=join(dir,'users.json'),token=newAccessToken();
  const access=new AccessControl({usersFile:file,optionalMissingUsersFile:true});
  denied(()=>access.authorize(token,admin,'rollout:read'),'UNAUTHORIZED');
  writeFileSync(file,JSON.stringify({version:1,users:[{id:'later',role:'auditor',disabled:false,tokenHash:tokenHash(token)}]}));
  assert.equal(access.authorize(token,admin,'rollout:read').id,'later');
  writeFileSync(file,'DO_NOT_ECHO_SECRET');
  assert.throws(()=>access.authorize(token,admin,'rollout:read'),(e:any)=>e.code==='INVALID_CONFIG'&&!e.message.includes('DO_NOT_ECHO_SECRET'));
  assert.equal(access.authorize(admin,admin,'rollout:read').role,'coordinator');
  writeFileSync(file,' '.repeat(65537));denied(()=>readAccessUsers(file),'INVALID_CONFIG');
  unlinkSync(file);denied(()=>new AccessControl({usersFile:file}),'INVALID_CONFIG');rmdirSync(dir);
});

test('management CLI creates expiring users without stdout credentials and revokes them',()=>{
  const dir=mkdtempSync(join(tmpdir(),'coop-security-cli-')),file=join(dir,'access-users.json'),out=join(dir,'alice-token.txt');
  const run=(...args:string[])=>spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/manage-access.mjs',import.meta.url)),...args,'--data-dir',dir],{encoding:'utf8'});
  try{
    const created=run('add','--id','alice','--role','auditor','--out',out);assert.equal(created.status,0,created.stderr);
    const token=readFileSync(out,'utf8').trim(),access=new AccessControl({usersFile:file});
    assert.equal(created.stdout.includes(token),false);assert.equal(created.stderr.includes(token),false);
    assert.equal(readFileSync(file,'utf8').includes(token),false);
    assert.equal(access.authorize(token,admin,'rollout:read').id,'alice');
    const listed=run('list');assert.equal(listed.status,0);assert.equal(listed.stdout.includes(tokenHash(token)),false);assert.equal(listed.stdout.includes(token),false);
    assert.equal(run('add','--id','alice','--role','operator','--out',out).status,1);
    assert.equal(run('revoke','--id','alice').status,0);denied(()=>access.authorize(token,admin,'rollout:read'),'UNAUTHORIZED');
  }finally{if(existsSync(file))unlinkSync(file);if(existsSync(out))unlinkSync(out);rmdirSync(dir);}
});

test('user schema rejects role escalation, duplicate identities and hashes, and ambiguous expiry',()=>{
  const user={id:'alice',role:'auditor',disabled:false,tokenHash:tokenHash(newAccessToken())};
  for(const bad of [null,[],{version:2,users:[]},{version:1,users:[],extra:true},
    {version:1,users:[{...user,role:'coordinator'}]},{version:1,users:[{...user,id:'coordinator'}]},
    {version:1,users:[{...user,disabled:'false'}]},{version:1,users:[{...user,token:'plaintext'}]},
    {version:1,users:[{...user,expiresAt:'2026-02-31T00:00:00.000Z'}]},
    {version:1,users:[{...user,expiresAt:'2027-01-01'}]},
    {version:1,users:[user,user]},{version:1,users:[user,{...user,id:'bob'}]},
    {version:1,users:[user,{...user,tokenHash:tokenHash(newAccessToken())}]},
    {version:1,users:Array(65).fill(user)}])denied(()=>validateAccessUsers(bad),'INVALID_CONFIG');
});
