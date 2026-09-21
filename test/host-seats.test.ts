import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HostSeats} from '../desktop/host-seats.mjs';
import {RemoteSession,ConnectionStore} from '../desktop/remote-session.mjs';
import {startMockApi} from '../desktop/mock-api.mjs';
import {PlayerRuntime,MinimalAgent,invitation,inviteUrl} from '../client/index.mjs';

test('verified provider key persists encrypted, never returns through IPC and cannot follow an edited URL',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'coop-model-storage-'));
 // Test-only reversible cipher; packaged checks separately exercise OS encryption.
 const encryption={isEncryptionAvailable:()=>true,encryptString:(s:string)=>Buffer.from(s).map(b=>b^173),decryptString:(b:Buffer)=>Buffer.from(b).map(n=>n^173).toString()};
 const remote={token:'synthetic-account',identity:{role:'operator',id:'owner'},apiUrl:'https://game.example/api/v1',epoch:1},configs:any[]=[];
 class Agent{constructor(config:any){configs.push(config);}async testConnection(){return {ok:true};}}
 const host=new HostSeats({remote,directory,encryption,Agent});
 assert.deepEqual(host.modelConfig(),{baseUrl:'https://api.deepseek.com',model:'deepseek-flash',hasApiKey:false,canRememberKey:true});
 await host.testModel({baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'synthetic-secret'});
 assert.ok(!readFileSync(host.modelFile()).includes(Buffer.from('synthetic-secret')));await host.close();
 const reopened=new HostSeats({remote,directory,encryption,Agent});assert.equal(reopened.modelConfig().hasApiKey,true);assert.ok(!JSON.stringify(reopened.modelConfig()).includes('synthetic-secret'));
 await reopened.testModel({baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:''});assert.equal(configs.at(-1).apiKey,'synthetic-secret');
 await assert.rejects(reopened.testModel({baseUrl:'https://wrong.example',model:'deepseek-flash',apiKey:''}),{code:'MODEL_CONFIG'});
 remote.identity.id='different-account';assert.equal(reopened.modelConfig().hasApiKey,false);remote.identity.id='owner';
 reopened.forgetModel();assert.equal(reopened.modelConfig().hasApiKey,false);await reopened.close();
});

test('room-only links contain no credential and still parse old invitations',()=>{
 const roomId='12345678-1234-1234-1234-123456789012',apiUrl='https://example.test/api/v1';
 const link=inviteUrl({apiUrl,roomId});assert.deepEqual(invitation(link),{apiUrl,roomId});assert.ok(!link.includes('invite='));
 assert.equal(invitation(inviteUrl({apiUrl,roomId,inviteToken:'x'.repeat(43)})).inviteToken,'x'.repeat(43));
 assert.throws(()=>invitation('coopbench://join#api=http://evil.example&room='+roomId));
});

test('host harnesses keep independent seat credentials, reserve once, copy occupied keys and stop on kick/logout',async()=>{
 const fixture=await startMockApi(),directory=mkdtempSync(join(tmpdir(),'coop-host-test-')),encryption={isEncryptionAvailable:()=>false};
 const remote=new RemoteSession({fetcher:fetch,store:new ConnectionStore(join(directory,'connection.json'),encryption)});
 await remote.connect({apiUrl:fixture.apiUrl,token:fixture.adminToken});
 const host=new HostSeats({remote,directory:join(directory,'host'),encryption,Runtime:PlayerRuntime,Agent:MinimalAgent});
 try{
  const created=await fixture.call('/rooms',fixture.adminToken,{gameId:'hanabi',scenarioId:'base',playerCount:3,allowHumans:true});
  await host.capture({path:'/api/v1/rooms',method:'POST'},{status:201,bytes:Buffer.from(JSON.stringify(created))});
  const first=await host.key({roomId:created.roomId,playerId:'p1'});assert.equal(first.seatToken,created.seatTokens[0].seatToken);
  const config={roomId:created.roomId,baseUrl:fixture.baseUrl+'/model',model:'test-model',apiKey:'synthetic-provider-key',rememberKey:false};
  await assert.rejects(host.start({...config,playerId:'p1'}),{code:'MODEL_TEST_REQUIRED'});
  await assert.rejects(host.testModel({...config,apiKey:'wrong-key'}),/401/);
  assert.equal((await fixture.call(`/rooms/${created.roomId}/admin`)).members.length,0,'A failed provider test cannot occupy a seat.');
  const {verificationId}=await host.testModel(config);
  const results=await Promise.allSettled([host.start({...config,playerId:'p1',verificationId}),host.start({...config,playerId:'p1',verificationId})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(host.agents.size,1);
  const verifiedSecond=await host.testModel(config);await host.start({...config,playerId:'p2',verificationId:verifiedSecond.verificationId});assert.equal(host.agents.size,2);
  const credentials=[...host.agents.values()].map(a=>a.runtime.credentials());assert.notEqual(credentials[0].playerToken,credentials[1].playerToken);
  assert.ok(credentials.every(c=>!JSON.stringify(c).includes(fixture.adminToken)));
  assert.equal((await host.key({roomId:created.roomId,playerId:'p1'})).seatToken,first.seatToken);
  const state=JSON.stringify(host.status({roomId:created.roomId}));assert.ok(!state.includes(first.seatToken)&&!state.includes(config.apiKey));
  const firstRuntime=host.agents.get(created.roomId+'/p1').runtime;
  firstRuntime.emit('agent-warning','MODEL_API_HTTP_400');
  firstRuntime.emit('state',{status:'waiting'});
  assert.match(host.status({roomId:created.roomId})[0].warning,/HTTP 400.*兼容性/,'Polling state does not hide a provider failure.');
  firstRuntime.emit('agent-warning','MODEL_API_HTTP_401');assert.match(host.status({roomId:created.roomId})[0].warning,/API key/);
  firstRuntime.emit('agent-warning','MODEL_TOOL_FORMAT');assert.match(host.status({roomId:created.roomId})[0].warning,/有效的工具调用/);
  firstRuntime.emit('agent-success');assert.equal(host.status({roomId:created.roomId})[0].warning,null);
  const kicked=await fixture.call(`/rooms/${created.roomId}/admin-kick`,fixture.adminToken,{playerId:'p1'});
  await host.capture({path:`/api/v1/rooms/${created.roomId}/admin-kick`,method:'POST',body:{playerId:'p1'}},{status:200,bytes:Buffer.from(JSON.stringify(kicked))});
  assert.equal(host.agents.size,1);
  const replacement=await host.key({roomId:created.roomId,playerId:'p1'});assert.notEqual(replacement.seatToken,first.seatToken);
  const second=[...host.agents.values()][0].runtime.credentials();assert.equal(second.playerToken,created.seatTokens[1].seatToken);
  await host.close();assert.equal(host.agents.size,0);assert.equal(host.keys.size,0);
 }finally{await host.close();remote.invalidate();await fixture.close();}
});
