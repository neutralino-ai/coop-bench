import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RemoteSession,validateRequest} from '../desktop/remote-session.mjs';

test('registration and room recovery keep private credentials inside the native session boundary',async()=>{
  const roomId=randomUUID(),sessionKey='hs1_'+'s'.repeat(43),hostKey='h'.repeat(43),seatKey='p'.repeat(43),registrationToken='r'.repeat(43),calls:any[]=[];
  const identity={id:'alice',role:'member'},store={load:()=>({apiUrl:'https://example.test/api/v1'}),save:(_url:string,_key:string,_remember:boolean)=>{}};
  const remote=new RemoteSession({store,fetcher:async(url:string,options:any)=>{
    calls.push({url,options});const path=new URL(url).pathname;
    const body=path.endsWith('/health')?{ok:true,service:'coop-bench',apiVersion:'v1'}:
      path.endsWith('/auth/register')?{token:sessionKey,identity,expiresAt:new Date(Date.now()+3600000).toISOString()}:
      path.endsWith('/identity')?identity:path.endsWith('/host')?{roomId,hostToken:hostKey}:
      path.endsWith('/resume')?{roomId,name:'Alice',playerToken:seatKey}:{roomId,status:'active'};
    return Response.json(body,{status:path.endsWith('/auth/register')?201:200});
  }});
  try{
    const login=await remote.register({apiUrl:'https://example.test/api/v1',userId:'alice',password:'Synthetic registered password 7!',registrationToken});
    assert.equal(login.identity.role,'member');for(const secret of [sessionKey,registrationToken])assert.ok(!JSON.stringify(login).includes(secret));
    const registration=calls.find(c=>c.url.endsWith('/auth/register'));assert.equal(registration.options.headers.Authorization,undefined);
    assert.equal((await remote.roomCredential(roomId,'resume')).playerToken,seatKey);
    for(const [method,path]of [['GET',`/api/v1/rooms/${roomId}/host`],['POST',`/api/v1/lobby/${roomId}/resume`],['POST','/api/v1/auth/register']])assert.throws(()=>validateRequest({id:randomUUID(),path,method,body:{}}));
    await remote.request({id:randomUUID(),path:`/api/v1/rooms/${roomId}/admin-start`,method:'POST',body:{}});
    const start=calls.at(-1);assert.equal(start.options.headers.Authorization,'Bearer '+sessionKey);assert.equal(start.options.headers['X-Room-Host-Token'],hostKey);
    await remote.request({id:randomUUID(),path:'/api/v1/lobby/mine',method:'GET'});assert.equal(calls.at(-1).options.headers['X-Room-Host-Token'],undefined);
    remote.invalidate();assert.equal(remote.hostTokens.size,0);await assert.rejects(remote.roomCredential(roomId,'host'));
  }finally{remote.invalidate();}
});
