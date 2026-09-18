import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Authority } from '../src/authority.ts';
import { createApi } from '../src/server.ts';
import { takeTime } from '../src/games/take-time.ts';
import { AccessControl, tokenHash } from '../src/access-control.ts';

const admin='messages-coordinator-token-example',operator='messages-operator-token-example',auditor='messages-auditor-token-example';
const item=(sequence=0,extra={})=>({sequence,messageId:`message-${sequence}`,kind:'model-input',message:{role:'user',content:[{type:'text',text:'Full original prompt'},{type:'image_url',image_url:{url:'https://example.invalid/unfetched.png'}}]},...extra});
async function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'coop-messages-http-')),usersFile=join(dir,'users.json');
  writeFileSync(usersFile,JSON.stringify({version:1,users:[{id:'operator',role:'operator',tokenHash:tokenHash(operator),disabled:false},{id:'auditor',role:'auditor',tokenHash:tokenHash(auditor),disabled:false}]}));
  const a=new Authority(':memory:',[takeTime],'messages-http');
  const app=createApi(a,admin,{access:new AccessControl({usersFile}),ratePolicy:{globalBurst:1000,credentialBurst:1000,heavyBurst:1000}});
  await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(app.address() as any).port}`;
  const call=(path:string,token='',body?:unknown)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const close=async()=>{app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));a.close();unlinkSync(usersFile);rmdirSync(dir);};
  return {a,call,close};
}
test('HTTP raw message capture is seat-only, active-game private, read-only for human roles and independent of gameplay',async()=>{
  const f=await fixture();try{
    const c=f.a.create('take-time',{playerCount:3,scenarioId:'official-clock-1-1',seed:'message-http'}),id=c.episodeId,seat=c.seats[0].token,other=c.seats[1].token;
    const path=`/api/v1/episodes/${id}/messages`,human=`/api/v1/rollouts/${id}/messages`;
    const before=f.a.db.prepare('SELECT * FROM episodes').get();
    for(const token of ['',operator,auditor,admin])assert.equal((await f.call(path,token,item())).status,401);
    const response=await f.call(path,seat,item());assert.equal(response.status,201);const saved=await response.json() as any;
    assert.equal(saved.playerId,'p1');assert.deepEqual(saved.message,item().message);assert.ok(saved.serverReceivedAt);
    const retry=await f.call(path,seat,item());assert.deepEqual(await retry.json(),saved);
    assert.equal((await f.call(path,seat,item(0,{message:{role:'assistant',content:'changed'}}))).status,409);
    assert.equal((await f.call(path,seat,item(2))).status,409);
    assert.equal((await f.call(path,seat,item(1,{playerId:'p2'}))).status,400);
    assert.deepEqual((await (await f.call(path,other)).json() as any).messages,[]);
    assert.equal((await f.call(path+'?playerId=p1',other)).status,400);
    assert.equal((await f.call(human,other)).status,401);
    assert.equal((await f.call(human,auditor)).status,403);
    const summary=await (await f.call(human,operator)).json() as any;assert.equal(summary.seats[0].messageCount,1);
    const page=await (await f.call(human+'?playerId=p1&after=-1&limit=1',operator)).json() as any;
    assert.deepEqual(page.messages[0].message,item().message);assert.equal(page.nextAfter,0);assert.equal(page.hasMore,false);
    assert.equal((await f.call(human+'?playerId=p9',operator)).status,404);
    for(const query of ['?limit=101','?after=-2','?limit=1&limit=2','?x=1'])assert.equal((await f.call(path+query,seat)).status,400);
    assert.deepEqual(f.a.db.prepare('SELECT * FROM episodes').get(),before);
    assert.equal(f.a.db.prepare('SELECT COUNT(*) AS n FROM events').get()!.n,1);
    const seal={scope:'All actual provider messages supplied by this fixture',completeness:'complete',reasoningAvailability:'not-provided',unavailable:['Internal reasoning not returned by provider']};
    assert.equal((await f.call(path+'/complete',seat,seal)).status,409);
    f.a.truncate(id,'test completed');
    assert.equal((await f.call(path,seat,item(1,{message:{role:'assistant',content:null,tool_calls:[{id:'call_1',function:{name:'observe',arguments:'{}'}}]},kind:'tool-call'}))).status,201);
    assert.equal((await f.call(path+'/complete',seat,seal)).status,200);
    assert.equal((await f.call(path,seat,item(2))).status,409);
    assert.equal((await f.call(path,seat,item())).status,201);
    const audit=await (await f.call(human+'?playerId=p1',auditor)).json() as any;
    assert.equal(audit.messages.length,2);assert.equal(audit.completion.completeness,'complete');assert.equal(audit.completion.provenance,'client-supplied-unverified');
    const identity=await (await f.call('/identity',operator)).json() as any;assert.equal(identity.retention.messages.messageCount,2);assert.equal(identity.retention.messages.sealedStreamCount,1);
  }finally{await f.close();}
});

test('message HTTP request size and response pagination are bounded without truncating structured message contents',async()=>{
  const f=await fixture();try{
    const c=f.a.create('take-time',{playerCount:3,scenarioId:'official-clock-1-1',seed:'messages-size'}),seat=c.seats[0].token,path=`/episodes/${c.episodeId}/messages`;
    assert.equal((await f.call(path,seat,item(0,{message:{role:'user',content:'x'.repeat(65000)}}))).status,413);
    assert.equal((await f.call(path,seat,item(0,{message:{role:'user',content:'x'.repeat(66000)}}))).status,413);
    for(let i=0;i<20;i++)f.a.appendMessage(c.episodeId,seat,item(i,{message:{role:'assistant',content:'x'.repeat(40000),tool_calls:[]}}));
    const first=await (await f.call(path+'?limit=100',seat)).json() as any;assert.equal(first.hasMore,true);assert.ok(first.messages.length<20);
    assert.equal(first.messages[0].message.content.length,40000);assert.equal(first.retention.maxPagePayloadBytes,512*1024);
    const next=await (await f.call(path+`?limit=100&after=${first.nextAfter}`,seat)).json() as any;
    assert.equal(next.hasMore,false);assert.equal(first.messages.length+next.messages.length,20);
  }finally{await f.close();}
});
