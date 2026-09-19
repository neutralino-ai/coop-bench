import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Authority } from '../src/authority.ts';
import { RoomStore } from '../src/room-store.ts';
import { games } from '../src/registry.ts';
import { createApi } from '../src/server.ts';

const setup={gameId:'hanabi',playerCount:2,scenarioId:'base'};
const token=()=>randomBytes(32).toString('base64url');
function members(rooms:RoomStore,r:any){return [1,2].map(i=>{const key=token();return {key,room:rooms.join(r.roomId,r.inviteToken,{name:`Player ${i}`,playerToken:key})};});}
function prepared(a:Authority,id:string,key:string,action:any){const obs=a.observe(id,key);return {observationId:obs.observationId,decisionToken:obs.decisionToken,action};}

test('rooms deal once, require fresh readiness and never disclose another seat token',()=>{
  const a=new Authority(':memory:',games,'room'),rooms=new RoomStore(a);try{
    const r=rooms.create('operator',setup),p=members(rooms,r),id=r.roomId;
    assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM episodes').get()!.n,0);
    assert.throws(()=>rooms.start(id,''),/credential/);assert.throws(()=>rooms.start(id,p[1].key),/host/);
    assert.throws(()=>rooms.ready(id,p[0].key,{ready:true,rosterVersion:p[0].room.rosterVersion}),/Roster changed/);
    assert.throws(()=>rooms.start(id,p[0].key),/All seats/);
    const rev=rooms.observe(id,p[0].key).rosterVersion;
    for(const player of p)rooms.ready(id,player.key,{ready:true,rosterVersion:rev});
    const started=rooms.start(id,p[0].key);assert.equal(rooms.start(id,p[0].key).episodeId,started.episodeId);
    assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM episodes').get()!.n,1);
    assert.equal(started.seats,undefined);assert.ok(!JSON.stringify(started).includes(p[1].key));
    const obs=a.observe(started.episodeId,p[0].key);assert.equal(obs.playerId,'p1');assert.equal(obs.control?.required,true);
    assert.ok(obs.view.hands.p1.every((c:any)=>c.value===undefined));
    assert.throws(()=>rooms.remove(id,'p2',p[0].key),/started/);
  }finally{a.close();}
});

test('kick revokes membership/invitation; failed start rolls back all game creation',()=>{
  const a=new Authority(':memory:',games,'room'),rooms=new RoomStore(a);try{
    const r=rooms.create('operator',setup),p=members(rooms,r);rooms.remove(r.roomId,'p2',p[0].key);
    assert.throws(()=>rooms.observe(r.roomId,p[1].key),/Invalid membership/);
    assert.throws(()=>rooms.join(r.roomId,r.inviteToken,{name:'rejoin',playerToken:token()}),/Invalid invitation/);
    const next=rooms.invite(r.roomId,p[0].key);assert.notEqual(next.inviteToken,r.inviteToken);
    assert.equal(rooms.join(r.roomId,next.inviteToken,{name:'New',playerToken:token()}).playerId,'p2');
    const bad=rooms.create('operator',{...setup,config:{unsupported:true}}),q=members(rooms,bad),version=rooms.admin(bad.roomId).rosterVersion;
    for(const m of q)rooms.ready(bad.roomId,m.key,{ready:true,rosterVersion:version});
    assert.throws(()=>rooms.start(bad.roomId,q[0].key));assert.equal(rooms.admin(bad.roomId).episodeId,null);
    assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM episodes').get()!.n,0);
  }finally{a.close();}
});

test('60s deadline survives restart; no observer required; terminal is truncation and replay stays valid',()=>{
  let time=100000;const file=join(mkdtempSync(join(tmpdir(),'coop-deadline-')),'game.sqlite');let a=new Authority(file,games,'deadline',()=>time);
  const c=a.create('hanabi',{playerCount:2,scenarioId:'base'});a.enableSessionBudget(c.episodeId);a.close();
  time+=60000;a=new Authority(file,games,'deadline',()=>time);try{
    a.advanceSessions();a.advanceSessions();const o=a.observe(c.episodeId,c.seats[0].token);
    assert.equal(o.status,'truncated');assert.equal(o.control?.endReason,'decision_timeout');assert.equal(o.outcome,null);
    assert.equal(a.db.prepare("SELECT COUNT(*) AS n FROM events WHERE episode_id=? AND kind='truncated'").get(c.episodeId)!.n,1);
    assert.equal(a.verifyReplay(c.episodeId).valid,true);
  }finally{a.close();}
});

test('invalid moves/reads never extend budget; accepted duplicate returns original receipt after expiry',()=>{
  let time=1000;const a=new Authority(':memory:',games,'deadline',()=>time);try{
    const c=a.create('hanabi',{playerCount:2,scenarioId:'base'});a.enableSessionBudget(c.episodeId);const [p1,p2]=c.seats;
    const first=a.observe(c.episodeId,p1.token),deadline=first.control!.deadlineAt;
    time+=10000;assert.equal(a.submit(c.episodeId,p1.token,'invalid',prepared(a,c.episodeId,p1.token,{type:'chat',text:'cheat'})).status,409);
    assert.equal(a.observe(c.episodeId,p1.token).control!.deadlineAt,deadline);
    const action={type:'hint',target:'p2',kind:'color',value:'red'},cmd=prepared(a,c.episodeId,p1.token,action);
    const receipt=a.submit(c.episodeId,p1.token,'ok',cmd);assert.equal(receipt.status,200);
    const stale=prepared(a,c.episodeId,p2.token,{type:'hint',target:'p1',kind:'color',value:'red'});
    time+=60000;assert.deepEqual(a.submit(c.episodeId,p1.token,'ok',cmd),receipt);
    assert.equal(a.submit(c.episodeId,p2.token,'late',stale).status,409);
    assert.equal(a.observe(c.episodeId,p2.token).status,'truncated');
    assert.equal(a.verifyReplay(c.episodeId).acceptedActions,1);
  }finally{a.close();}
});

test('The Game multi-card turn and optional chat share one budget; Magic Maze uses official playing clock',()=>{
  let time=1000;const a=new Authority(':memory:',games,'deadline',()=>time);try{
    for(const game of games)assert.equal(typeof game.decisionWindow,'function',game.metadata.id);
    const c=a.create('the-game',{playerCount:2,scenarioId:'base'});a.enableSessionBudget(c.episodeId);
    const p=c.seats[0],before=a.observe(c.episodeId,p.token),chat=prepared(a,c.episodeId,p.token,{type:'chat',text:'Let us review the public piles.'});
    time+=10000;assert.equal(a.submit(c.episodeId,p.token,'chat',chat).status,200);assert.equal(a.observe(c.episodeId,p.token).control!.deadlineAt,before.control!.deadlineAt);
    const g=games.find(g=>g.metadata.id==='magic-maze')!,state=g.setup({playerCount:2,scenarioId:g.metadata.scenarios[0].id,seed:'test'});
    assert.equal(g.decisionWindow!(state)?.mode,'all');state.phase='playing';assert.equal(g.decisionWindow!(state),null);
  }finally{a.close();}
});

test('room HTTP privilege separation and SSE delivery carry only the authenticated seat',async()=>{
  const a=new Authority(':memory:',games,'sse'),server=createApi(a,'coordinator-token-for-session-tests');
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as any).port}/api/v1`;
  const abort=new AbortController();
  try{
    const rooms=new RoomStore(a),r=rooms.create('owner',setup),p=members(rooms,r),version=rooms.admin(r.roomId).rosterVersion;
    assert.equal((await fetch(`${base}/rooms/${r.roomId}/start`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    assert.equal((await fetch(`${base}/rooms/${r.roomId}/admin`,{headers:{Authorization:`Bearer ${p[0].key}`}})).status,401);
    for(const m of p)rooms.ready(r.roomId,m.key,{ready:true,rosterVersion:version});const c=rooms.start(r.roomId,p[0].key);
    const response=await fetch(`${base}/episodes/${c.episodeId}/events`,{headers:{Authorization:`Bearer ${p[0].key}`},signal:abort.signal});
    assert.equal(response.status,200);const reader=response.body!.getReader(),first=await reader.read(),text=new TextDecoder().decode(first.value);
    const packet=JSON.parse(text.split('\n').find(line=>line.startsWith('data: '))!.slice(6));assert.equal(packet.observation.playerId,'p1');
    assert.ok(packet.observation.view.hands.p1.every((x:any)=>x.value===undefined));assert.ok(!text.includes(p[1].key));
    a.truncate(c.episodeId,'test_end');const next=await reader.read();assert.match(new TextDecoder().decode(next.value),/truncated/);await reader.cancel();
  }finally{abort.abort();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));a.close();}
});
