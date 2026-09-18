import test from 'node:test';
import assert from 'node:assert/strict';
import { Authority } from '../src/authority.ts';
import { createApi } from '../src/server.ts';
import { games } from '../src/registry.ts';
import { PlayerClient } from '../src/player-client.ts';
import { createPlayerTools } from '../src/agent-tools.ts';
test('HTTP creation, separate player client, duplicate receipt, terminal audit and service restart contract',async()=>{
  const authority=new Authority(':memory:',games,'http-test'),admin='coordinator-token-for-local-test-only',server=createApi(authority,admin);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(server.address() as any).port}`;
  const request=(path:string,token?:string,body?:unknown)=>fetch(base+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  try{
    assert.equal((await request('/')).status,200);assert.equal((await request('/app.js')).status,200);
    const catalog=await (await request('/games')).json() as any;assert.equal(catalog.games.length,games.length);
    const config={gameId:'take-time',playerCount:3,scenarioId:'official-clock-1-1'};
    assert.equal((await request('/episodes',undefined,config)).status,401);
    assert.equal((await request('/episodes',admin,{...config,seed:'known-to-player'})).status,409);
    const created=await (await request('/episodes',admin,config)).json() as any;
    const clients=created.seats.map((s:any)=>new PlayerClient(base,created.episodeId,s.token));
    await clients[0].observe();const prepared=clients[0].prepare({type:'look_hand'},'We finished agreeing on a strategy.');
    const first=await clients[0].submit(prepared);assert.equal(first.httpStatus,200);assert.deepEqual(await clients[0].submit(prepared),first);
    assert.equal((await request(`/episodes/${created.episodeId}/audit`,created.seats[0].token)).status,401);
    assert.equal((await request(`/episodes/${created.episodeId}/audit`,admin)).status,409);
    for(const client of clients.slice(1)){await client.observe();assert.equal((await client.submit(client.prepare({type:'look_hand'}))).httpStatus,200);}
    for(let turn=0;turn<12;turn++){const client=clients[turn%3];const obs=await client.observe();const action=obs.legalActions[0].examples[0];const result=await client.submit(client.prepare(action));assert.equal(result.httpStatus,200);}
    const obs=await clients[1].observe();assert.equal(obs.status,'completed');assert.equal(obs.outcome?.kind,'loss');
    const replay=await (await request(`/episodes/${created.episodeId}/replay`,admin)).json() as any;assert.equal(replay.valid,true);
    const training=await (await request(`/episodes/${created.episodeId}/training`,admin)).json() as any;
    assert.equal(training.rows.length,15);assert.equal(training.terminalTeamReward,0);assert.equal(training.truncated,false);
    assert.ok(training.rows.every((r:any)=>r.playerId===r.observed.playerId));
    const denied=await fetch(base+'/games',{headers:{Origin:'https://evil.example'}});assert.equal(denied.status,403);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));authority.close();}
});

test('agent tools expose only one player, enforce speech stage and preserve retries',async()=>{
  const authority=new Authority(':memory:',games,'tool-test'),server=createApi(authority,'coordinator-token-for-test-tools');
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const baseUrl=`http://127.0.0.1:${(server.address() as any).port}`;
  try{
    const c=authority.create('take-time',{playerCount:3,scenarioId:'official-clock-1-1',seed:'tools'});
    const tools=createPlayerTools({baseUrl,episodeId:c.episodeId,gameId:'take-time',token:c.seats[0].token});
    assert.deepEqual(tools.definitions.map(x=>x.name),['read_rules','observe','send_message','act']);
    const initial=await tools.call('observe',{}) as any;assert.equal(initial.playerId,'p1');assert.equal(initial.view.hand,null);
    const message={requestId:'discussion',action:{type:'speak',text:'I will keep the opening position in mind.'}};
    const first=await tools.call('send_message',message);assert.deepEqual(await tools.call('send_message',message),first);
    assert.equal((await tools.call('act',{requestId:'look',action:{type:'look_hand'}}) as any).httpStatus,200);
    const blocked=await tools.call('send_message',{requestId:'after-looking',action:{type:'speak',text:'This should be forbidden.'}}) as any;
    assert.equal(blocked.httpStatus,409);
    await assert.rejects(tools.call('audit',{}),/Unknown tool/);
    await assert.rejects(tools.call('send_message',{...message,action:{type:'speak',text:'different'}}),/reused/);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));authority.close();}
});
