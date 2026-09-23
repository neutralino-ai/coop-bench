import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RemoteSession,validateRequest} from '../desktop/remote-session.mjs';
import {startMockApi} from '../desktop/mock-api.mjs';

test('operator native command is separate from generic IPC; members cannot invoke account mutations',async()=>{
 for(const role of ['operator','member']){
  const fixture=await startMockApi({role}),remote=new RemoteSession({fetcher:fetch,store:{load:()=>({apiUrl:fixture.apiUrl}),save(){}}});
  try{
   await remote.register({apiUrl:fixture.apiUrl,userId:'owner',password:'Synthetic password 123!',registrationToken:fixture.adminToken});
   const input={operation:'invitations',body:{requestId:randomUUID(),count:2,expiresInDays:30}};
   if(role==='member'){await assert.rejects(remote.operatorCommand(input),{code:'PERMISSION_DENIED'});assert.equal(fixture.requests.some(r=>r.path.startsWith('/api/v1/operator/')),false);}
   else {const value=await remote.operatorCommand(input);assert.equal(value.invitations.length,2);assert.deepEqual(await remote.operatorCommand(input),value);const users=await remote.request({id:randomUUID(),path:'/api/v1/operator/users',method:'GET'});assert.equal(users.status,200);const games=await remote.request({id:randomUUID(),path:'/api/v1/operator/games?limit=25',method:'GET'});assert.equal(games.status,200);assert.ok(JSON.parse(new TextDecoder().decode(games.bytes)).items[0].participants.length>0);await assert.rejects(remote.operatorCommand({operation:'../auth/login',body:input.body}));}
   for(const operation of ['invitations','users/reset-password','users/delete','games/delete'])assert.throws(()=>validateRequest({id:randomUUID(),path:'/api/v1/operator/'+operation,method:'POST',body:{}}));
  }finally{remote.invalidate();await fixture.close();}
 }
});
