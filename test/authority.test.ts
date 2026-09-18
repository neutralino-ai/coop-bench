import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Authority, digest, type Envelope } from '../src/authority.ts';
import { takeTime } from '../src/games/take-time.ts';
import { crewDeepSea } from '../src/games/crew.ts';
import { check, clone } from '../src/common.ts';
import type { Action, GameAdapter } from '../src/types.ts';
const setup={playerCount:3,scenarioId:'official-clock-1-1',seed:'persisted-test'};
const command=(obs:Envelope,action:Action)=>({observationId:obs.observationId,decisionToken:obs.decisionToken,action});
function local(){const a=new Authority(':memory:',[takeTime,crewDeepSea],'test-build');const c=a.create('take-time',setup);return {a,c};}
test('per-seat identity, private values, unsupported scopes and issued observation binding',()=>{
  const {a,c}=local();try{
    const [p1,p2]=c.seats;const one=a.observe(c.episodeId,p1.token),two=a.observe(c.episodeId,p2.token);
    assert.equal(one.view.hand,null);assert.ok(!JSON.stringify(one).includes(setup.seed));
    assert.throws(()=>a.observe(c.episodeId,'wrong'),/credential/);
    assert.equal(a.submit(c.episodeId,p1.token,'cross-seat',command(two,{type:'look_hand'})).status,409);
    const accepted=a.submit(c.episodeId,p1.token,'look',command(one,{type:'look_hand'}));assert.equal(accepted.status,200);
    assert.equal(accepted.body.observation.view.hand.length,4);
    assert.equal(a.observe(c.episodeId,p2.token).view.hand,null);
    assert.throws(()=>a.create('just-one',setup),/not admitted/);
    assert.throws(()=>a.create('take-time',{...setup,scenarioId:'clock-1-2'}),/Unsupported/);
    assert.throws(()=>a.audit(c.episodeId),/after completion/);
  }finally{a.close();}
});
test('same idempotency key returns exact committed receipt before stale checks, conflicts reject',()=>{
  const {a,c}=local();try{
    const p=c.seats[0],obs=a.observe(c.episodeId,p.token),cmd=command(obs,{type:'look_hand'});
    const first=a.submit(c.episodeId,p.token,'request-1',cmd);
    assert.deepEqual(a.submit(c.episodeId,p.token,'request-1',cmd),first);
    assert.throws(()=>a.submit(c.episodeId,p.token,'request-1',command(obs,{type:'speak',text:'x'})),/different command/);
    assert.equal(a.submit(c.episodeId,p.token,'request-2',cmd).status,409);
    a.truncate(c.episodeId,'test-budget');const audit=a.audit(c.episodeId);
    assert.equal(audit.events.filter((e:any)=>e.kind==='accepted').length,1);
    assert.equal(audit.events.filter((e:any)=>e.kind==='rejected').length,1);
    assert.equal(a.verifyReplay(c.episodeId).valid,true);
  }finally{a.close();}
});
test('public changes invalidate stale intents; failed actions do not move cards or consume decision token',()=>{
  const {a,c}=local();try{
    const [p,q]=c.seats;const po=a.observe(c.episodeId,p.token),qo=a.observe(c.episodeId,q.token);
    a.submit(c.episodeId,q.token,'q-speak',command(qo,{type:'speak',text:'Agree on positions before looking.'}));
    assert.equal(a.submit(c.episodeId,p.token,'stale',command(po,{type:'look_hand'})).body.error.code,'STALE_OBSERVATION');
    const fresh=a.observe(c.episodeId,p.token);
    assert.equal(a.submit(c.episodeId,p.token,'illegal',command(fresh,{type:'place',cardId:'invented',position:1})).status,409);
    const after=a.observe(c.episodeId,p.token);assert.deepEqual(after.view,fresh.view);assert.equal(after.decisionToken,fresh.decisionToken);
  }finally{a.close();}
});
test('SQLite restart preserves state, credentials, observations, committed receipts and replay',()=>{
  const dir=mkdtempSync(join(tmpdir(),'coop-bench-sqlite-')),file=join(dir,'episodes.sqlite');
  let a=new Authority(file,[takeTime],'pinned');
  try{
    const c=a.create('take-time',setup),seat=c.seats[0],obs=a.observe(c.episodeId,seat.token),cmd=command(obs,{type:'look_hand'});
    const result=a.submit(c.episodeId,seat.token,'restart-retry',cmd);a.close();a=new Authority(file,[takeTime],'pinned');
    assert.deepEqual(a.submit(c.episodeId,seat.token,'restart-retry',cmd),result);
    assert.deepEqual(a.observe(c.episodeId,seat.token).view,result.body.observation.view);
    a.truncate(c.episodeId,'stopped');assert.equal(a.verifyReplay(c.episodeId).valid,true);
    const data=a.exportTraining(c.episodeId);assert.equal(data.terminalTeamReward,null);assert.equal(data.truncated,true);assert.equal(data.rows.length,1);
    assert.ok(!JSON.stringify(data.rows).includes(setup.seed));
    a.close();a=new Authority(file,[takeTime],'changed');assert.throws(()=>a.observe(c.episodeId,seat.token),/build differs/);
  }finally{a.close();for(const f of readdirSync(dir))unlinkSync(join(dir,f));rmdirSync(dir);}
});
test('private Crew sealed commitments do not invalidate another player view or token',()=>{
  const a=new Authority(':memory:',[crewDeepSea],'test');
  try{
    const c=a.create(crewDeepSea.metadata.id,{playerCount:3,scenarioId:crewDeepSea.metadata.scenarios[0].id,seed:'private-commits'});
    for(const seat of c.seats){const obs=a.observe(c.episodeId,seat.token);const res=a.submit(c.episodeId,seat.token,`vote-${seat.playerId}`,command(obs,{type:'distress_vote',direction:'left'}));assert.equal(res.status,200);}
    const before=c.seats.map(s=>a.observe(c.episodeId,s.token));
    const action=before[0].legalActions.find(x=>x.type==='distress_pass')!.examples![0];
    assert.equal(a.submit(c.episodeId,c.seats[0].token,'commit-p1',command(before[0],action)).status,200);
    const after=a.observe(c.episodeId,c.seats[1].token);
    assert.deepEqual(after.view,before[1].view);assert.deepEqual(after.legalActions,before[1].legalActions);assert.equal(after.decisionToken,before[1].decisionToken);
    assert.deepEqual(after.updates,before[1].updates);assert.equal(after.updateCursor,before[1].updateCursor);
    for(let i=1;i<3;i++){const action=before[i].legalActions.find(x=>x.type==='distress_pass')!.examples![0];assert.equal(a.submit(c.episodeId,c.seats[i].token,`commit-${i}`,command(before[i],action)).status,200);}
    a.truncate(c.episodeId,'test');assert.equal(a.verifyReplay(c.episodeId).valid,true);
  }finally{a.close();}
});

test('per-player update cursor preserves every transient public event without counting invisible operations',()=>{
  const fixture:GameAdapter={metadata:{...takeTime.metadata,id:'transient-feed'},setup:()=>({lastEvent:null,hiddenCount:0}),
    observe:s=>({lastEvent:s.lastEvent}),activePlayers:()=>['p1','p2','p3'],legalActions:()=>[],
    step:(s,p,a)=>a.type==='private'?{...s,hiddenCount:s.hiddenCount+1}:{...s,lastEvent:{playerId:p,text:a.text}},outcome:()=>null};
  const a=new Authority(':memory:',[fixture],'test');try{
    const c=a.create('transient-feed',setup),[p1,p2,p3]=c.seats,first=a.observe(c.episodeId,p1.token);
    for(const [seat,text] of [[p2,'first public hint'],[p3,'second public hint']] as const){
      const o=a.observe(c.episodeId,seat.token);assert.equal(a.submit(c.episodeId,seat.token,seat.playerId,command(o,{type:'say',text})).status,200);
    }
    const later=a.observe(c.episodeId,p1.token,first.updateCursor);
    assert.equal(later.view.lastEvent.text,'second public hint');
    assert.deepEqual(later.updates!.map(u=>u.view.lastEvent.text),['first public hint','second public hint']);
    const other=a.observe(c.episodeId,p2.token);a.submit(c.episodeId,p2.token,'invisible',command(other,{type:'private'}));
    const unchanged=a.observe(c.episodeId,p1.token,later.updateCursor);
    assert.deepEqual(unchanged.updates,[]);assert.equal(unchanged.updateCursor,later.updateCursor);assert.equal(unchanged.decisionToken,later.decisionToken);
    // Re-pulling an unacknowledged cursor returns the same prepared updates.
    assert.deepEqual(a.observe(c.episodeId,p1.token,first.updateCursor).updates,later.updates);
  }finally{a.close();}
});
test('even a projection failure after SQL state update rolls back the entire action',()=>{
  const buggy:GameAdapter={metadata:{...takeTime.metadata,id:'fault-injection'},setup:()=>({count:0}),observe:(s)=>{check(s.count===0,'Injected view failure.','INTERNAL');return {count:s.count};},activePlayers:()=>['p1'],legalActions:()=>[],step:s=>({count:s.count+1}),outcome:()=>null};
  const a=new Authority(':memory:',[buggy],'test');try{
    const c=a.create(buggy.metadata.id,{...setup,playerCount:3}),p=c.seats[0],before=a.observe(c.episodeId,p.token);
    assert.equal(a.submit(c.episodeId,p.token,'broken',command(before,{type:'advance'})).status,500);
    const after=a.observe(c.episodeId,p.token);assert.deepEqual(after.view,before.view);assert.equal(after.decisionToken,before.decisionToken);
    a.truncate(c.episodeId,'test');assert.equal(a.verifyReplay(c.episodeId).valid,true);
  }finally{a.close();}
});
test('Take Time adapter reuses deterministic official engine and completes 2/3/4-player JSON-round-trip games',()=>{
  for(const playerCount of [2,3,4]){
    let s=takeTime.setup({...setup,playerCount}),n=0;
    assert.equal(digest(s),digest(takeTime.setup({...setup,playerCount})));
    assert.equal(takeTime.observe(s,'p1').hand,null);
    while(!takeTime.outcome(s)){
      const p=takeTime.activePlayers(s)[0],before=clone(s),action=takeTime.legalActions(s,p).flatMap(a=>a.examples??[])[0];
      assert.ok(action);s=takeTime.step(s,p,action);assert.deepEqual(before,JSON.parse(JSON.stringify(before)));s=JSON.parse(JSON.stringify(s));assert.ok(++n<=20);
    }
    assert.equal(takeTime.outcome(s)!.success,false);assert.equal(s.actions.filter(x=>x.action.type==='place').length,12);
    assert.equal(takeTime.observe(s,'p1').phase,'finished');
  }
});
