import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { startLocalApp } from '../src/server.ts';
import { RemoteSession, ConnectionStore } from '../desktop/remote-session.mjs';

test('password set by one desktop works in a fresh independent client; logout is per session', async t => {
  const directory=mkdtempSync(join(tmpdir(),'coop-cross-client-')),usersFile=join(directory,'users.json');
  const token='synthetic-'+randomUUID(),password='  合作bench Ａa9! '+randomUUID()+'  ';
  writeFileSync(usersFile,JSON.stringify({version:1,users:[{id:'owner',role:'operator',disabled:false,tokenHash:createHash('sha256').update(token).digest('hex')}]}));
  const api=await startLocalApp({dataDir:join(directory,'api'),port:0,serveWeb:false,usersFile,trustedProxyOrigin:'https://synthetic.example.test'});
  const encryption={isEncryptionAvailable:()=>false};
  const first=new RemoteSession({fetcher:fetch,store:new ConnectionStore(join(directory,'first.json'),encryption)});
  const second=new RemoteSession({fetcher:fetch,store:new ConnectionStore(join(directory,'second.json'),encryption)});
  t.after(async()=>{first.invalidate();second.invalidate();await api.close();rmSync(directory,{recursive:true,force:true});});
  await first.connect({apiUrl:api.apiUrl,token,remember:false});await first.setPassword({password,remember:false});
  await assert.rejects(second.login({apiUrl:api.apiUrl,userId:'owner',password:password.trim(),remember:false}),{code:'AUTH_REJECTED'});
  assert.equal((await second.login({apiUrl:api.apiUrl,userId:'owner',password,remember:false})).identity.id,'owner');
  assert.notEqual(first.token,second.token);assert.equal((await first.getAccount()).passwordConfigured,true);
  await second.logout();assert.equal((await first.getAccount()).userId,'owner');
  assert.equal((await second.login({apiUrl:api.apiUrl,userId:'owner',password,remember:false})).identity.id,'owner');
  assert.equal(readFileSync(join(directory,'second.json'),'utf8').includes(password),false);
});
