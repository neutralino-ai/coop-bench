import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Authority } from '../src/authority.ts';
import { createApi } from '../src/server.ts';
import { games } from '../src/registry.ts';
import { takeTime } from '../src/games/take-time.ts';
import type { Action, GameAdapter } from '../src/types.ts';

const admin='rollout-tests-coordinator-credential';
const clockGame:GameAdapter={
  metadata:{...takeTime.metadata,id:'rollout-clock-fixture',name:'Rollout clock fixture'},
  setup:()=>({remainingMs:1000,moves:0}),observe:s=>({...s}),
  activePlayers:s=>s.remainingMs?['p1']:[],
  legalActions:s=>s.remainingMs?[{type:'move',description:'test fixture',schema:{},examples:[{type:'move'}]}]:[],
  step:s=>({...s,moves:s.moves+1}),
  advanceTime:(s,ms)=>({...s,remainingMs:Math.max(0,s.remainingMs-ms)}),
  outcome:s=>s.remainingMs===0?{kind:'loss',success:false,score:0,maxScore:1,reason:'fixture-timeout'}:null
};

async function serve(authority:Authority) {
  const server=createApi(authority,admin);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  return {
    base,
    async request(path:string,token?:string,payload?:unknown,requestId?:string) {
      const response=await fetch(base+'/api/v1'+path,{method:payload===undefined?'GET':'POST',signal:AbortSignal.timeout(5000),
        headers:{...(token?{Authorization:`Bearer ${token}`} : {}),
          ...(payload===undefined?{}:{'Content-Type':'application/json'}),...(requestId?{'Idempotency-Key':requestId}:{})},
        ...(payload===undefined?{}:{body:JSON.stringify(payload)})});
      return {status:response.status,body:await response.json() as any};
    },
    async close(){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  };
}
type Api=Awaited<ReturnType<typeof serve>>;

function create(authority:Authority,gameId='take-time') {
  return authority.create(gameId,{playerCount:3,scenarioId:'official-clock-1-1',seed:'rollout-http-fixture'});
}

async function act(api:Api,id:string,token:string,key:string,action:Action,decisionSummary='A short declared decision reason.') {
  const observed=await api.request(`/episodes/${id}/observation`,token);
  assert.equal(observed.status,200);
  const command={observationId:observed.body.observationId,decisionToken:observed.body.decisionToken,action,decisionSummary};
  return {observed:observed.body,command,...await api.request(`/episodes/${id}/actions`,token,command,key)};
}

/** Snapshot every existing game authority table; audit-only writes must not alter them. */
function gameSnapshot(authority:Authority,id:string) {
  return Object.fromEntries(['episodes','seats','views','clocks','visible_updates','observations','commands','events','rollout_frames'].map(table=>[
    table,authority.db.prepare(`SELECT * FROM ${table} WHERE ${table==='episodes'?'id':'episode_id'}=? ORDER BY rowid`).all(id)
  ]));
}

function withoutDecisionTokens(value:any):any {
  if(Array.isArray(value))return value.map(withoutDecisionTokens);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='decisionToken').map(([key,item])=>[key,withoutDecisionTokens(item)]));
  return value;
}

function temporaryDatabase() {
  const root=realpathSync(tmpdir()),path=mkdtempSync(join(root,'coop-bench-rollout-http-'));
  return {path:join(path,'episodes.sqlite'),remove(){
    if(!existsSync(path))return;
    const actual=realpathSync(path),child=relative(root,actual);
    assert.equal(actual,resolve(path));
    assert.ok(child && !isAbsolute(child) && child!=='..' && !child.startsWith(`..${sep}`));
    assert.ok(basename(actual).startsWith('coop-bench-rollout-http-'));
    rmSync(actual,{recursive:true,force:true});
  }};
}

test('rollout audit routes require coordinator credentials; debug play assets stay local and credential-free',async()=>{
  const authority=new Authority(':memory:',games,'rollout-http-permissions'),api=await serve(authority);
  try{
    const c=create(authority),seat=c.seats[0].token;
    for(const path of ['/rollouts',`/rollouts/${c.episodeId}`]){
      for(const token of [undefined,'incorrect-credential',seat]){
        const denied=await api.request(path,token);assert.equal(denied.status,401);assert.equal(denied.body.error.code,'UNAUTHORIZED');
      }
      assert.equal((await api.request(path,admin)).status,200);
    }
    for(const token of [undefined,seat]){
      const denied=await api.request(`/rollouts/${c.episodeId}/annotations`,token,{kind:'review',text:'Unauthorized review.'});
      assert.equal(denied.status,401);
    }
    const badOrigin=await fetch(api.base+'/api/v1/rollouts',{headers:{Authorization:`Bearer ${admin}`,Origin:'not-a-url'},signal:AbortSignal.timeout(5000)});
    assert.equal(badOrigin.status,403);assert.equal((await badOrigin.json() as any).error.code,'FORBIDDEN');
    for(const asset of ['/','/app.js','/style.css','/play','/play.js','/play.css']){
      const response=await fetch(api.base+asset,{signal:AbortSignal.timeout(5000)});assert.equal(response.status,200,asset);
      const content=await response.text();assert.ok(!content.includes(admin),asset);assert.ok(!content.includes(seat),asset);
    }
    assert.equal((await api.request('/rollouts/not-an-episode',admin)).status,404);
  }finally{await api.close();authority.close();}
});

test('rollout listing paginates and filters status/game while rejecting malformed pagination',async()=>{
  let clock=1000;
  const authority=new Authority(':memory:',[...games,clockGame],'rollout-http-list',()=>clock),api=await serve(authority);
  try{
    const active=create(authority),truncated=create(authority),completed=create(authority,'rollout-clock-fixture');
    authority.truncate(truncated.episodeId,'Test budget ended.');
    clock+=1001;authority.observe(completed.episodeId,completed.seats[0].token);
    const listed=await api.request('/rollouts?limit=2&offset=0',admin);
    assert.equal(listed.status,200);assert.equal(listed.body.total,3);assert.equal(listed.body.limit,2);assert.equal(listed.body.offset,0);assert.equal(listed.body.items.length,2);
    const second=await api.request('/rollouts?limit=2&offset=2',admin);
    assert.equal(second.status,200);assert.equal(second.body.items.length,1);
    assert.equal(new Set([...listed.body.items,...second.body.items].map((r:any)=>r.episodeId)).size,3);
    for(const [status,id] of [['active',active.episodeId],['completed',completed.episodeId],['truncated',truncated.episodeId]]){
      const filtered=await api.request(`/rollouts?status=${status}`,admin);
      assert.equal(filtered.status,200);assert.equal(filtered.body.total,1);assert.equal(filtered.body.items[0].episodeId,id);
    }
    const filtered=await api.request('/rollouts?gameId=take-time',admin);
    assert.equal(filtered.status,200);assert.equal(filtered.body.total,2);
    assert.ok(filtered.body.items.every((r:any)=>r.gameId==='take-time'));
    assert.equal((await api.request('/rollouts?offset=999',admin)).body.items.length,0);
    for(const query of ['limit=0','limit=-1','limit=201','limit=1.5','limit=abc','offset=-1','offset=0.5','offset=abc','status=unknown','unknown=1']){
      const invalid=await api.request('/rollouts?'+query,admin);
      assert.equal(invalid.status,400,query);assert.equal(invalid.body.error.code,'INVALID_REQUEST',query);
    }
  }finally{await api.close();authority.close();}
});

test('rollout frames preserve accepted and rejected decisions, exact actor input, time, and separate post-action projections',async()=>{
  const authority=new Authority(':memory:',games,'rollout-http-frames'),api=await serve(authority);
  try{
    const c=create(authority),p1=c.seats[0];
    const looked=await act(api,c.episodeId,p1.token,'look','look_hand' as any);
    // A malformed action is deliberately rejected and still belongs in the audit.
    assert.equal(looked.status,400);
    const accepted=await act(api,c.episodeId,p1.token,'actual-look',{type:'look_hand'},'Discussion is complete; inspect my hand.');
    assert.equal(accepted.status,200);
    const afterAccepted=gameSnapshot(authority,c.episodeId);
    const retry=await api.request(`/episodes/${c.episodeId}/actions`,p1.token,accepted.command,'actual-look');
    assert.equal(retry.status,200);assert.deepEqual(retry.body,accepted.body);
    assert.deepEqual(gameSnapshot(authority,c.episodeId),afterAccepted,'An idempotent retry must not duplicate audit frames.');
    const rejected=await act(api,c.episodeId,p1.token,'forbidden-speech',{type:'speak',text:'Forbidden after looking.'},'A deliberately invalid test action.');
    assert.equal(rejected.status,409);
    const snapshot=gameSnapshot(authority,c.episodeId);
    const result=await api.request(`/rollouts/${c.episodeId}`,admin);
    assert.equal(result.status,200);assert.ok(result.body.schemaVersion);assert.equal(result.body.summary.episodeId,c.episodeId);
    assert.equal(result.body.players.length,3);assert.ok(Array.isArray(result.body.frames));
    const acceptedFrame=result.body.frames.find((f:any)=>f.kind==='accepted');
    const rejectedFrames=result.body.frames.filter((f:any)=>f.kind==='rejected');
    assert.ok(acceptedFrame);assert.equal(rejectedFrames.length,2);
    assert.deepEqual(acceptedFrame.observed,withoutDecisionTokens(accepted.observed));
    assert.deepEqual(acceptedFrame.action,{type:'look_hand'});
    assert.equal(acceptedFrame.decisionSummary,'Discussion is complete; inspect my hand.');
    assert.ok(Number.isFinite(Date.parse(acceptedFrame.at)));
    assert.equal(acceptedFrame.observed.view.hand,null);
    assert.deepEqual(acceptedFrame.views.p1.view,accepted.body.observation.view);
    assert.equal(acceptedFrame.views.p2.view.hand,null);
    assert.equal(acceptedFrame.coverage,'recorded');
    assert.deepEqual(acceptedFrame.viewProvenance,{p1:'server-projection',p2:'server-projection',p3:'server-projection'});
    assert.deepEqual(rejectedFrames[1].observed,withoutDecisionTokens(rejected.observed));
    const serialized=JSON.stringify(result.body);
    assert.ok(!serialized.includes(accepted.observed.decisionToken));assert.ok(!serialized.includes(p1.token));
    assert.deepEqual(gameSnapshot(authority,c.episodeId),snapshot);
  }finally{await api.close();authority.close();}
});

test('reading rollout list and detail never ticks the game clock or issues player observations',async()=>{
  let clock=1000;
  const authority=new Authority(':memory:',[clockGame],'rollout-http-readonly',()=>clock),api=await serve(authority);
  try{
    const c=create(authority,'rollout-clock-fixture');
    const snapshot=gameSnapshot(authority,c.episodeId);
    clock+=100000;
    for(let count=0;count<2;count++){
      assert.equal((await api.request('/rollouts',admin)).status,200);
      const detail=await api.request(`/rollouts/${c.episodeId}`,admin);
      assert.equal(detail.status,200);assert.equal(detail.body.summary.status,'active');
      assert.deepEqual(gameSnapshot(authority,c.episodeId),snapshot);
    }
    // The actual player observation still performs the authoritative clock update.
    assert.equal((await api.request(`/episodes/${c.episodeId}/observation`,c.seats[0].token)).body.status,'completed');
  }finally{await api.close();authority.close();}
});

test('seat reflections open only after terminal state and cannot impersonate reviews or change training/game state',async()=>{
  let clock=1000;
  const authority=new Authority(':memory:',[clockGame],'rollout-http-reflections',()=>clock),api=await serve(authority);
  try{
    const c=create(authority,'rollout-clock-fixture'),p1=c.seats[0],p2=c.seats[1];
    const early=await api.request(`/episodes/${c.episodeId}/reflections`,p1.token,{text:'Do not expose this during play.'});
    assert.equal(early.status,409);assert.equal(early.body.error.code,'EPISODE_ACTIVE');
    assert.equal((await act(api,c.episodeId,p1.token,'move',{type:'move'})).status,200);
    clock+=1001;await api.request(`/episodes/${c.episodeId}/observation`,p1.token);
    const before=gameSnapshot(authority,c.episodeId),training=await api.request(`/episodes/${c.episodeId}/training`,admin);
    const reflected=await api.request(`/episodes/${c.episodeId}/reflections`,p1.token,{text:'I should have acted sooner.'});
    assert.ok([200,201].includes(reflected.status));
    const review=await api.request(`/rollouts/${c.episodeId}/annotations`,admin,{kind:'review',text:'Timing caused the fixture loss.'});
    assert.ok([200,201].includes(review.status));
    for(const payload of [{text:'Forged p2 reflection.',playerId:p2.playerId},{text:'Forged coordinator review.',kind:'review'},{text:'Forged source.',source:'coordinator'}]){
      const forged=await api.request(`/episodes/${c.episodeId}/reflections`,p1.token,payload);
      assert.ok([400,409].includes(forged.status));
    }
    assert.equal((await api.request(`/episodes/${c.episodeId}/reflections`,admin,{text:'Admin is not a player seat.'})).status,401);
    assert.equal((await api.request(`/episodes/${c.episodeId}/reflections`,undefined,{text:'No credential.'})).status,401);
    const otherEpisode=create(authority,'rollout-clock-fixture');
    assert.equal((await api.request(`/episodes/${c.episodeId}/reflections`,otherEpisode.seats[0].token,{text:'Wrong episode credential.'})).status,401);
    assert.equal((await api.request(`/rollouts/${c.episodeId}/annotations`,p1.token,{kind:'review',text:'Seat is not a coordinator.'})).status,401);
    const detail=await api.request(`/rollouts/${c.episodeId}`,admin);
    assert.equal(detail.body.annotations.length,2);
    const annotation=detail.body.annotations.find((a:any)=>a.kind==='reflection');
    assert.equal(annotation.playerId,p1.playerId);assert.equal(annotation.source,'seat');
    assert.equal(annotation.text,'I should have acted sooner.');
    assert.equal(detail.body.annotations.find((a:any)=>a.kind==='review').source,'coordinator');
    assert.deepEqual(gameSnapshot(authority,c.episodeId),before);
    assert.deepEqual(await api.request(`/episodes/${c.episodeId}/training`,admin),training);
    assert.ok(!JSON.stringify(training.body.rows).includes('I should have acted sooner.'));
  }finally{await api.close();authority.close();}
});

test('rollouts and annotations survive restart under another build with no game adapter; continuation and replay stay pinned',async()=>{
  const temp=temporaryDatabase();let authority:Authority|undefined,api:Api|undefined;
  try{
    authority=new Authority(temp.path,games,'old-engine-build');api=await serve(authority);
    const c=create(authority);await act(api,c.episodeId,c.seats[0].token,'look',{type:'look_hand'});
    authority.truncate(c.episodeId,'Persisted rollout test.');
    const annotated=await api.request(`/rollouts/${c.episodeId}/annotations`,admin,{kind:'review',text:'A persisted reviewer note.'});
    assert.ok([200,201].includes(annotated.status));
    const before=await api.request(`/rollouts/${c.episodeId}`,admin),auditBefore=await api.request(`/episodes/${c.episodeId}/audit`,admin);
    await api.close();api=undefined;authority.close();authority=undefined;
    authority=new Authority(temp.path,[],'new-engine-build');api=await serve(authority);
    const listing=await api.request('/rollouts',admin);assert.equal(listing.status,200);assert.equal(listing.body.total,1);
    const detail=await api.request(`/rollouts/${c.episodeId}`,admin);
    assert.equal(detail.status,200);assert.deepEqual(detail.body.frames,before.body.frames);assert.deepEqual(detail.body.annotations,before.body.annotations);
    assert.equal(detail.body.metadata.id,'take-time');
    assert.deepEqual(await api.request(`/episodes/${c.episodeId}/audit`,admin),auditBefore);
    const training=await api.request(`/episodes/${c.episodeId}/training`,admin);assert.equal(training.status,200);assert.equal(training.body.rows.length,1);
    for(const [path,token] of [[`/episodes/${c.episodeId}/observation`,c.seats[0].token],[`/episodes/${c.episodeId}/replay`,admin]]){
      const pinned=await api.request(path,token);assert.equal(pinned.status,409);assert.equal(pinned.body.error.code,'BUILD_MISMATCH');
    }
  }finally{await api?.close();authority?.close();temp.remove();}
});

test('legacy rollouts label missing views and never fill an earlier frame with a later private hand',async()=>{
  const authority=new Authority(':memory:',games,'rollout-http-legacy'),api=await serve(authority);
  try{
    const c=create(authority);
    const first=await act(api,c.episodeId,c.seats[0].token,'first-look',{type:'look_hand'});
    assert.equal(first.status,200);
    assert.equal((await act(api,c.episodeId,c.seats[1].token,'later-look',{type:'look_hand'})).status,200);
    authority.truncate(c.episodeId,'Legacy migration fixture.');
    // Older databases have observations and events, but no transactional rollout frames.
    authority.db.prepare('DELETE FROM rollout_frames WHERE episode_id=?').run(c.episodeId);
    const before=gameSnapshot(authority,c.episodeId);
    const detail=await api.request(`/rollouts/${c.episodeId}`,admin);
    assert.equal(detail.status,200);assert.equal(detail.body.summary.coverage,'actor-only');
    const created=detail.body.frames.find((f:any)=>f.kind==='created');
    assert.equal(created.coverage,'unavailable');assert.deepEqual(created.views,{});assert.equal(created.observed,null);
    const frame=detail.body.frames.find((f:any)=>f.requestId==='first-look');
    assert.equal(frame.coverage,'actor-only');assert.deepEqual(Object.keys(frame.views),['p1']);
    assert.deepEqual(frame.viewProvenance,{p1:'issued-observation'});
    assert.deepEqual(frame.observed,withoutDecisionTokens(first.observed));
    assert.equal(frame.observed.view.hand,null);assert.equal(frame.views.p1.view.hand.length,4);
    assert.equal(frame.views.p2,undefined);assert.equal(frame.views.p3,undefined);
    assert.deepEqual(gameSnapshot(authority,c.episodeId),before);
  }finally{await api.close();authority.close();}
});
