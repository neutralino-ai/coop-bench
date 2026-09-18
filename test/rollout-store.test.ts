import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Authority, type Envelope } from '../src/authority.ts';
import { takeTime } from '../src/games/take-time.ts';
import { check } from '../src/common.ts';
import type { Action, GameAdapter } from '../src/types.ts';

const setup={playerCount:3,scenarioId:'official-clock-1-1',seed:'rollout-fixture'};
const command=(obs:Envelope,action:Action)=>({observationId:obs.observationId,decisionToken:obs.decisionToken,action,decisionSummary:'A short player-authored explanation.'});
const fixture=(end=2):GameAdapter=>({
  metadata:{...takeTime.metadata,id:'rollout-fixture'},setup:()=>({count:0}),
  observe:(s,p)=>({count:s.count,privateValue:`${p}-secret-${s.count}`}),activePlayers:()=>['p1','p2','p3'],legalActions:()=>[],
  step:(s,p,a)=>{check(a.type==='advance','Illegal fixture action.');return {count:s.count+1};},
  outcome:s=>s.count>=end?{kind:'win',success:true,score:1,reason:'fixture complete',details:{count:s.count}}:null,
});
const temp=()=>{const dir=mkdtempSync(join(tmpdir(),'coop-rollout-'));return {file:join(dir,'db.sqlite'),clean:()=>{for(const file of readdirSync(dir))unlinkSync(join(dir,file));rmdirSync(dir);}};};

test('every event stores exact actor before, all prepared after-views and no decision credentials',()=>{
  const game=fixture(),a=new Authority(':memory:',[game],'build');
  try{
    const c=a.create(game.metadata.id,setup),[p1,p2]=c.seats;
    const before=a.observe(c.episodeId,p1.token),cmd=command(before,{type:'advance'});
    const first=a.submit(c.episodeId,p1.token,'one',cmd);
    assert.deepEqual(a.submit(c.episodeId,p1.token,'one',cmd),first);
    const own=a.observe(c.episodeId,p2.token);
    assert.equal(a.submit(c.episodeId,p2.token,'illegal',command(own,{type:'illegal'})).status,409);
    a.truncate(c.episodeId,'budget');
    const result=a.getRollout(c.episodeId);
    assert.deepEqual(result.frames.map((f:any)=>f.kind),['created','accepted','rejected','truncated']);
    assert.equal(result.summary.coverage,'recorded');
    assert.equal(result.summary.actionCount,1);assert.equal(result.summary.rejectedCount,1);
    assert.deepEqual(result.frames[1].observed.view,before.view);
    assert.equal(result.frames[1].observed.observationId,before.observationId);
    assert.equal(result.frames[1].observed.decisionToken,undefined);
    assert.equal(result.frames[1].views.p2.view.privateValue,'p2-secret-1');
    assert.equal(result.frames[1].viewProvenance.p2,'server-projection');
    assert.deepEqual(result.frames[2].observed.view,own.view);
    assert.equal(result.frames[2].views.p2.view.count,1);assert.equal(result.frames[2].error.code,'ILLEGAL_ACTION');
    assert.equal(result.frames[3].status,'truncated');assert.equal(result.summary.outcome,null);
    assert.ok(!JSON.stringify(result).includes(before.decisionToken));
    assert.ok(!JSON.stringify(result).includes(p1.token));
  }finally{a.close();}
});

test('recorded frames survive restart and can be read without the original adapter or engine build',()=>{
  const {file,clean}=temp(),game=fixture(1);let a=new Authority(file,[game],'original');
  try{
    const c=a.create(game.metadata.id,setup),p=c.seats[0];
    a.submit(c.episodeId,p.token,'one',command(a.observe(c.episodeId,p.token),{type:'advance'}));
    const original=a.getRollout(c.episodeId);a.close();a=new Authority(file,[],'new-code');
    const historic=a.getRollout(c.episodeId);
    assert.deepEqual(historic.frames,original.frames);assert.equal(historic.summary.build,'original');
    assert.equal(historic.summary.compatibleBuild,false);assert.equal(historic.summary.outcome.success,true);
    assert.equal(a.listRollouts().items.length,1);assert.equal(a.audit(c.episodeId).outcome.details.count,1);
    assert.equal(a.exportTraining(c.episodeId).terminalTeamReward,1);
    assert.throws(()=>a.observe(c.episodeId,p.token),/build differs/);
    assert.throws(()=>a.verifyReplay(c.episodeId),/build differs/);
    assert.equal(a.submitReflection(c.episodeId,p.token,'A preserved post-game reflection.').source,'seat');
  }finally{a.close();clean();}
});

test('legacy schema migration preserves 21 exact action observations without fabricating other-seat history',()=>{
  const {file,clean}=temp(),game=fixture(21);let a=new Authority(file,[game],'old-build');
  try{
    const c=a.create(game.metadata.id,setup),p=c.seats[0];
    for(let i=0;i<21;i++)a.submit(c.episodeId,p.token,`move-${i}`,command(a.observe(c.episodeId,p.token),{type:'advance'}));
    // Simulate the already deployed database, before rollout snapshot tables existed.
    a.db.exec('DROP TABLE rollout_frames; DROP TABLE rollout_annotations;');a.close();a=new Authority(file,[],'changed-build');
    const beforeCount=a.db.prepare('SELECT COUNT(*) AS n FROM observations').get()!.n;
    const result=a.getRollout(c.episodeId),accepted=result.frames.filter((f:any)=>f.kind==='accepted');
    assert.equal(result.summary.actionCount,21);assert.equal(result.summary.outcome.success,true);
    assert.equal(result.summary.coverage,'actor-only');assert.equal(result.frames[0].coverage,'unavailable');
    assert.deepEqual(result.frames[0].views,{});
    for(let i=0;i<21;i++){
      assert.equal(accepted[i].observed.view.count,i);assert.equal(accepted[i].views.p1.view.count,i+1);
      assert.equal(accepted[i].views.p2,undefined);assert.equal(accepted[i].viewProvenance.p1,'issued-observation');
      assert.equal(accepted[i].observed.decisionToken,undefined);
    }
    assert.equal(a.audit(c.episodeId).outcome.success,true);
    assert.equal(a.exportTraining(c.episodeId).rows.length,21);
    assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM observations').get()!.n,beforeCount);
    assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM rollout_frames').get()!.n,0);
  }finally{a.close();clean();}
});

test('rollout persistence failure rolls back action, issued observation, receipt and state atomically',()=>{
  const game=fixture(),a=new Authority(':memory:',[game],'build');
  try{
    const c=a.create(game.metadata.id,setup),p=c.seats[0],before=a.observe(c.episodeId,p.token),cmd=command(before,{type:'advance'});
    a.db.exec(`CREATE TRIGGER reject_frame BEFORE INSERT ON rollout_frames WHEN NEW.seq=1 BEGIN SELECT RAISE(ABORT,'injected frame failure'); END;`);
    assert.throws(()=>a.submit(c.episodeId,p.token,'atomic',cmd),/injected frame failure/);
    assert.equal(a.getRollout(c.episodeId).frames.length,1);
    assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM commands').get()!.n,0);
    assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM observations').get()!.n,1);
    assert.equal(JSON.parse(a.db.prepare('SELECT state FROM episodes').get()!.state as string).count,0);
    a.db.exec('DROP TRIGGER reject_frame;');
    assert.equal(a.submit(c.episodeId,p.token,'atomic',cmd).status,200);
    assert.equal(a.getRollout(c.episodeId).frames.length,2);
  }finally{a.close();}
});

test('projection failure produces a rejected frame of rolled-back state, not attempted state',()=>{
  const game=fixture();game.observe=s=>{check(s.count===0,'Injected projection failure.','INTERNAL');return {count:s.count};};
  const a=new Authority(':memory:',[game],'build');
  try{
    const c=a.create(game.metadata.id,setup),p=c.seats[0],before=a.observe(c.episodeId,p.token);
    assert.equal(a.submit(c.episodeId,p.token,'failed',command(before,{type:'advance'})).status,500);
    const frame=a.getRollout(c.episodeId).frames[1];
    assert.equal(frame.kind,'rejected');assert.equal(frame.views.p1.view.count,0);assert.equal(frame.status,'active');
  }finally{a.close();}
});

test('elapsed frames are recorded but list/detail do not advance an authoritative game clock',()=>{
  let time=1000;const game=fixture(1);game.advanceTime=(s,ms)=>({count:s.count+ms});
  const a=new Authority(':memory:',[game],'build',()=>time);
  try{
    const c=a.create(game.metadata.id,setup),p=c.seats[0];time+=25;
    assert.equal(a.getRollout(c.episodeId).frames.length,1);assert.equal(a.listRollouts().items[0].status,'active');
    assert.equal(a.db.prepare('SELECT last_ms FROM clocks').get()!.last_ms,1000);
    a.observe(c.episodeId,p.token);
    const result=a.getRollout(c.episodeId),frame=result.frames[1];
    assert.equal(frame.kind,'elapsed');assert.equal(frame.elapsedMs,25);assert.equal(frame.views.p3.view.count,25);
    assert.equal(result.summary.status,'completed');assert.equal(result.summary.outcome.success,true);
  }finally{a.close();}
});

test('annotations validate identity, survive restart and never change the training trajectory or reward',()=>{
  const {file,clean}=temp(),game=fixture(1);let a=new Authority(file,[game],'build');
  try{
    const c=a.create(game.metadata.id,setup),p=c.seats[0];
    assert.throws(()=>a.submitReflection(c.episodeId,p.token,'early'),/after completion/);
    assert.throws(()=>a.submitReflection(c.episodeId,'not-a-seat','spoof'),/credential/);
    a.submit(c.episodeId,p.token,'complete',command(a.observe(c.episodeId,p.token),{type:'advance'}));
    const training=a.exportTraining(c.episodeId),frames=a.getRollout(c.episodeId).frames;
    const reflection=a.submitReflection(c.episodeId,p.token,'I should have made a clearer plan.');
    assert.equal(reflection.playerId,'p1');assert.equal(reflection.source,'seat');
    const review=a.addRolloutAnnotation(c.episodeId,{kind:'review',playerId:'p2',text:'Reviewer opinion.',source:'seat'});
    assert.equal(review.source,'coordinator:seat');
    assert.throws(()=>a.addRolloutAnnotation(c.episodeId,{kind:'review',text:'x'.repeat(20001)}),/20000/);
    assert.throws(()=>a.addRolloutAnnotation(c.episodeId,{kind:'review',text:' ',playerId:'p8'}),/Annotation/);
    assert.deepEqual(a.exportTraining(c.episodeId),training);assert.deepEqual(a.getRollout(c.episodeId).frames,frames);
    a.close();a=new Authority(file,[],'new-build');
    assert.equal(a.getRollout(c.episodeId).annotations.length,2);
  }finally{a.close();clean();}
});

test('summary filtering and pagination remain explicit and bounded',()=>{
  const game=fixture(),a=new Authority(':memory:',[game],'build');
  try{
    a.create(game.metadata.id,setup);const ended=a.create(game.metadata.id,setup);a.truncate(ended.episodeId,'stop');
    assert.equal(a.listRollouts({limit:1}).items.length,1);assert.equal(a.listRollouts({limit:1}).total,2);
    assert.equal(a.listRollouts({status:'truncated'}).items[0].episodeId,ended.episodeId);
    assert.equal(a.listRollouts({gameId:'absent'}).total,0);
    assert.equal(a.listRollouts({offset:10}).items.length,0);
    for(const args of [{limit:0},{limit:201},{offset:-1},{status:'won'}])assert.throws(()=>a.listRollouts(args),e=>(e as any).code==='INVALID_REQUEST');
  }finally{a.close();}
});

test('SQL list summaries match detail evidence for recorded, mixed and legacy episodes without parsing private histories in JS',()=>{
  const game=fixture(2),marker='large-private-observation-only-',a=new Authority(':memory:',[game],'build');
  game.observe=(s,p)=>({count:s.count,privateValue:`${marker}${p}`,largePrivateState:'x'.repeat(64000)});
  try{
    const active=a.create(game.metadata.id,setup);
    const truncated=a.create(game.metadata.id,setup);a.truncate(truncated.episodeId,'budget');
    const completed=a.create(game.metadata.id,setup),legacy=a.create(game.metadata.id,setup),mixed=a.create(game.metadata.id,setup);
    for(const c of [completed,legacy,mixed]){
      const seat=c.seats[0];
      for(let i=0;i<2;i++)a.submit(c.episodeId,seat.token,`move-${i}`,command(a.observe(c.episodeId,seat.token),{type:'advance'}));
    }
    a.db.prepare('DELETE FROM rollout_frames WHERE episode_id=?').run(legacy.episodeId);
    a.db.prepare('DELETE FROM rollout_frames WHERE episode_id=? AND seq=0').run(mixed.episodeId);
    a.addRolloutAnnotation(legacy.episodeId,{kind:'review',text:'An imported historical review.'});
    // Long histories of polling must not be pulled into the list endpoint's JS heap.
    for(let i=0;i<20;i++)a.observe(active.episodeId,active.seats[1].token);
    const expected=[mixed,legacy,completed,truncated,active].map(c=>a.getRollout(c.episodeId).summary);
    const originalParse=JSON.parse;
    JSON.parse=(text:string,...rest:any[])=>{
      assert.ok(!text.includes(marker),'list deserialized a full private observation/frame');
      return originalParse(text,...rest);
    };
    let listed:any;
    try{listed=a.listRollouts();}finally{JSON.parse=originalParse;}
    assert.deepEqual(listed.items,expected);
    assert.deepEqual(a.listRollouts({limit:2,offset:1}).items,expected.slice(1,3));
    assert.deepEqual(a.listRollouts({status:'completed'}).items,expected.slice(0,3));
    assert.deepEqual(expected.map(s=>s.coverage),['actor-only','actor-only','recorded','recorded','recorded']);
    assert.equal(expected[1].outcomeDetailsAvailable,false);assert.equal(expected[2].outcomeDetailsAvailable,true);
  }finally{a.close();}
});

test('legacy timeout list summary uses the terminal issued outcome when there is no actor receipt',()=>{
  let time=10;const game=fixture(1);game.advanceTime=(s,ms)=>({count:s.count+ms});
  const a=new Authority(':memory:',[game],'build',()=>time);
  try{
    const c=a.create(game.metadata.id,setup);time+=2;a.observe(c.episodeId,c.seats[2].token);
    a.db.prepare('DELETE FROM rollout_frames WHERE episode_id=?').run(c.episodeId);
    const expected=a.getRollout(c.episodeId).summary;
    assert.equal(expected.coverage,'unavailable');assert.equal(expected.outcome.success,true);assert.equal(expected.actionCount,0);
    assert.deepEqual(a.listRollouts().items,[expected]);
  }finally{a.close();}
});
