import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HostSeats} from '../desktop/host-seats.mjs';
import {RemoteSession,ConnectionStore} from '../desktop/remote-session.mjs';
import {startMockApi} from '../desktop/mock-api.mjs';
import {PlayerRuntime,MinimalAgent,invitation,inviteUrl} from '../client/index.mjs';

test('room-only links contain no credential and still parse old invitations',()=>{
 const roomId='12345678-1234-1234-1234-123456789012',apiUrl='https://example.test/api/v1';
 const link=inviteUrl({apiUrl,roomId});assert.deepEqual(invitation(link),{apiUrl,roomId});assert.ok(!link.includes('invite='));
 assert.equal(invitation(inviteUrl({apiUrl,roomId,inviteToken:'x'.repeat(43)})).inviteToken,'x'.repeat(43));
 assert.throws(()=>invitation('coopbench://join#api=http://evil.example&room='+roomId));
});

test('host harnesses keep independent seat credentials, reserve once, reject occupied keys and stop on kick/logout',async()=>{
 const fixture=await startMockApi(),directory=mkdtempSync(join(tmpdir(),'coop-host-test-')),encryption={isEncryptionAvailable:()=>false};
 const remote=new RemoteSession({fetcher:fetch,store:new ConnectionStore(join(directory,'connection.json'),encryption)});
 await remote.connect({apiUrl:fixture.apiUrl,token:fixture.adminToken});
 const host=new HostSeats({remote,directory:join(directory,'host'),encryption,Runtime:PlayerRuntime,Agent:MinimalAgent});
 try{
  const created=await fixture.call('/rooms',fixture.adminToken,{gameId:'hanabi',scenarioId:'base',playerCount:3,allowHumans:true});
  await host.capture({path:'/api/v1/rooms',method:'POST'},{status:201,bytes:Buffer.from(JSON.stringify(created))});
  const first=await host.key({roomId:created.roomId,playerId:'p1'});assert.equal(first.seatToken,created.seatTokens[0].seatToken);
  const config={roomId:created.roomId,baseUrl:fixture.baseUrl+'/model',model:'test-model',apiKey:'synthetic-provider-key'};
  const results=await Promise.allSettled([host.start({...config,playerId:'p1'}),host.start({...config,playerId:'p1'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(host.agents.size,1);
  await host.start({...config,playerId:'p2'});assert.equal(host.agents.size,2);
  const credentials=[...host.agents.values()].map(a=>a.runtime.credentials());assert.notEqual(credentials[0].playerToken,credentials[1].playerToken);
  assert.ok(credentials.every(c=>!JSON.stringify(c).includes(fixture.adminToken)));
  await assert.rejects(host.key({roomId:created.roomId,playerId:'p1'}),/已经有人/);
  const state=JSON.stringify(host.status({roomId:created.roomId}));assert.ok(!state.includes(first.seatToken)&&!state.includes(config.apiKey));
  const kicked=await fixture.call(`/rooms/${created.roomId}/admin-kick`,fixture.adminToken,{playerId:'p1'});
  await host.capture({path:`/api/v1/rooms/${created.roomId}/admin-kick`,method:'POST',body:{playerId:'p1'}},{status:200,bytes:Buffer.from(JSON.stringify(kicked))});
  assert.equal(host.agents.size,1);
  const replacement=await host.key({roomId:created.roomId,playerId:'p1'});assert.notEqual(replacement.seatToken,first.seatToken);
  const second=[...host.agents.values()][0].runtime.credentials();assert.equal(second.playerToken,created.seatTokens[1].seatToken);
  await host.close();assert.equal(host.agents.size,0);assert.equal(host.keys.size,0);
 }finally{await host.close();remote.invalidate();await fixture.close();}
});
