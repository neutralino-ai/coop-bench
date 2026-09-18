import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Authority, type AuthorityLimits, type Envelope } from '../src/authority.ts';
import { takeTime } from '../src/games/take-time.ts';
import { check } from '../src/common.ts';
import type { Action, GameAdapter } from '../src/types.ts';

const setup={playerCount:3,scenarioId:'official-clock-1-1',seed:'security-resource-fixture'};
const fixture=():GameAdapter=>({
  metadata:{...takeTime.metadata,id:'security-resource-fixture'},setup:()=>({count:0,text:''}),
  observe:(s,p)=>({count:s.count,text:s.text,privateLabel:p}),activePlayers:()=>['p1','p2','p3'],legalActions:()=>[],
  step:(s,p,a)=>{check(a.type==='advance','Invalid fixture action.');return {count:s.count+1,text:a.text??s.text};},outcome:()=>null,
});
const command=(o:Envelope,action:Action)=>({observationId:o.observationId,decisionToken:o.decisionToken,action});
const limited=(limits:Partial<AuthorityLimits>={})=>new Authority(':memory:',[fixture()],'security-test',Date.now,limits);
const count=(a:Authority,table:string)=>Number(a.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
const resource=(fn:()=>unknown)=>assert.throws(fn,(e:any)=>e.code==='RESOURCE_LIMIT');

test('100 identical polls reuse one persisted exact observation, while changed views retain their own evidence',()=>{
  const a=limited();try{
    const c=a.create('security-resource-fixture',setup),p=c.seats[0],first=a.observe(c.episodeId,p.token);
    for(let i=0;i<100;i++)assert.deepEqual(a.observe(c.episodeId,p.token),first);
    assert.equal(count(a,'observations'),1);assert.equal(count(a,'observation_cache'),1);
    const result=a.submit(c.episodeId,p.token,'move',command(first,{type:'advance'}));
    assert.equal(result.status,200);assert.notEqual(result.body.observation.observationId,first.observationId);
    const frame=a.getRollout(c.episodeId).frames[1];
    assert.equal(frame.observed.observationId,first.observationId);assert.equal(frame.observed.view.count,0);
    a.truncate(c.episodeId,'resource test');assert.equal(a.verifyReplay(c.episodeId).valid,true);
  }finally{a.close();}
});

test('observation dedup and storage accounting survive restart; existing history is never rewritten',()=>{
  const dir=mkdtempSync(join(tmpdir(),'coop-security-resource-')),file=join(dir,'episodes.sqlite');
  let a=new Authority(file,[fixture()],'security-test');
  try{
    const c=a.create('security-resource-fixture',setup),p=c.seats[0],first=a.observe(c.episodeId,p.token);
    const bytes=a.db.prepare('SELECT bytes FROM episode_storage').get()!.bytes;
    a.close();a=new Authority(file,[fixture()],'security-test');
    assert.deepEqual(a.observe(c.episodeId,p.token),first);assert.equal(count(a,'observations'),1);
    assert.equal(a.db.prepare('SELECT bytes FROM episode_storage').get()!.bytes,bytes);
  }finally{a.close();for(const entry of readdirSync(dir))unlinkSync(join(dir,entry));rmdirSync(dir);}
});

test('alternating cursors cannot evade the per-seat observation budget or damage another seat',()=>{
  const a=limited({maxObservationsPerSeat:2});try{
    const c=a.create('security-resource-fixture',setup),[p,q]=c.seats,first=a.observe(c.episodeId,p.token);
    const empty=a.observe(c.episodeId,p.token,first.updateCursor);
    assert.notEqual(empty.observationId,first.observationId);
    for(let i=0;i<20;i++)assert.equal(a.observe(c.episodeId,p.token,i%2).observationId,i%2?empty.observationId:first.observationId);
    resource(()=>a.submit(c.episodeId,p.token,'needs-new-view',command(first,{type:'advance'})));
    assert.equal(count(a,'commands'),0);assert.equal(count(a,'events'),1);
    assert.equal(a.observe(c.episodeId,q.token).view.count,0);
    a.truncate(c.episodeId,'observation budget');assert.equal(a.getRollout(c.episodeId).summary.status,'truncated');
  }finally{a.close();}
});

test('bad-action flood stops before adding more rejected frames; committed idempotency receipts remain readable',()=>{
  const a=limited({maxCommandsPerEpisode:2});try{
    const c=a.create('security-resource-fixture',setup),p=c.seats[0],o=a.observe(c.episodeId,p.token),cmd=command(o,{type:'invalid'});
    const first=a.submit(c.episodeId,p.token,'bad-1',cmd);assert.equal(first.status,409);
    assert.equal(a.submit(c.episodeId,p.token,'bad-2',cmd).status,409);
    const bytes=a.db.prepare('SELECT bytes FROM episode_storage').get()!.bytes;
    for(let i=0;i<10;i++)resource(()=>a.submit(c.episodeId,p.token,`overflow-${i}`,cmd));
    assert.equal(count(a,'commands'),2);assert.equal(count(a,'events'),3);
    assert.equal(a.db.prepare('SELECT bytes FROM episode_storage').get()!.bytes,bytes);
    assert.deepEqual(a.submit(c.episodeId,p.token,'bad-1',cmd),first);
    a.truncate(c.episodeId,'command budget');assert.equal(a.verifyReplay(c.episodeId).valid,true);
    assert.equal(a.exportTraining(c.episodeId).terminalTeamReward,null);
  }finally{a.close();}
});

test('timed polling cannot append unlimited elapsed snapshots, and resource exhaustion remains truncation',()=>{
  let time=0;const game=fixture();game.advanceTime=(s,ms)=>({...s,count:s.count+ms});
  const a=new Authority(':memory:',[game],'security-test',()=>time,{maxEventsPerEpisode:3});try{
    const c=a.create(game.metadata.id,setup),p=c.seats[0];
    time=1;a.observe(c.episodeId,p.token);time=2;a.observe(c.episodeId,p.token);
    time=3;resource(()=>a.observe(c.episodeId,p.token));
    assert.equal(count(a,'events'),3);assert.equal(a.db.prepare('SELECT last_ms FROM clocks').get()!.last_ms,2);
    a.truncate(c.episodeId,'elapsed event budget');const audit=a.audit(c.episodeId);
    assert.equal(audit.status,'truncated');assert.equal(audit.events.length,4);assert.equal(audit.outcome,null);
    assert.equal(a.verifyReplay(c.episodeId).valid,true);
  }finally{a.close();}
});

test('storage amplification rolls back state, snapshots, cache and receipt atomically at a byte budget',()=>{
  const a=limited({maxStoredBytesPerEpisode:100000});try{
    const c=a.create('security-resource-fixture',setup),p=c.seats[0],o=a.observe(c.episodeId,p.token);
    const before=a.db.prepare('SELECT bytes FROM episode_storage').get()!.bytes;
    resource(()=>a.submit(c.episodeId,p.token,'amplify',command(o,{type:'advance',text:'x'.repeat(50000)})));
    assert.equal(count(a,'commands'),0);assert.equal(count(a,'events'),1);assert.equal(count(a,'observations'),1);
    assert.equal(count(a,'observation_cache'),1);assert.equal(a.db.prepare('SELECT bytes FROM episode_storage').get()!.bytes,before);
    assert.deepEqual(a.observe(c.episodeId,p.token),o);
    assert.equal(a.submit(c.episodeId,p.token,'small',command(o,{type:'advance'})).status,200);
    a.truncate(c.episodeId,'byte budget');assert.equal(a.verifyReplay(c.episodeId).valid,true);
  }finally{a.close();}
});

test('total and active episode quotas persist in SQLite and finishing frees active capacity only',()=>{
  const a=limited({maxEpisodes:2,maxActiveEpisodes:1});try{
    const one=a.create('security-resource-fixture',setup);
    resource(()=>a.create('security-resource-fixture',setup));assert.equal(count(a,'episodes'),1);
    a.truncate(one.episodeId,'free active slot');const two=a.create('security-resource-fixture',setup);
    a.truncate(two.episodeId,'end second');resource(()=>a.create('security-resource-fixture',setup));
    assert.equal(count(a,'episodes'),2);assert.equal(a.getRollout(one.episodeId).summary.status,'truncated');
  }finally{a.close();}
});

test('global payload budget prevents distributing storage growth over many episodes',()=>{
  const probe=limited();let initialBytes:number;
  try{probe.create('security-resource-fixture',setup);initialBytes=Number(probe.db.prepare('SELECT bytes FROM episode_storage').get()!.bytes);}
  finally{probe.close();}
  const a=limited({maxStoredBytesTotal:initialBytes!*2-1});try{
    const c=a.create('security-resource-fixture',setup);
    resource(()=>a.create('security-resource-fixture',setup));
    assert.equal(count(a,'episodes'),1);assert.equal(count(a,'episode_storage'),1);assert.equal(count(a,'events'),1);
    a.truncate(c.episodeId,'global budget');assert.equal(a.getRollout(c.episodeId).summary.status,'truncated');
  }finally{a.close();}
});

test('seat and episode annotation limits block append floods without changing training evidence',()=>{
  const a=limited({maxAnnotationsPerSeat:1,maxAnnotationsPerEpisode:3});try{
    const c=a.create('security-resource-fixture',setup),[p,q]=c.seats;a.truncate(c.episodeId,'annotation test');
    const training=a.exportTraining(c.episodeId);
    a.submitReflection(c.episodeId,p.token,'First reflection.');
    resource(()=>a.submitReflection(c.episodeId,p.token,'Repeated reflection.'));
    a.submitReflection(c.episodeId,q.token,'Independent reflection.');
    a.addRolloutAnnotation(c.episodeId,{kind:'review',text:'One review.'});
    resource(()=>a.addRolloutAnnotation(c.episodeId,{kind:'review',text:'Unbounded extra review.'}));
    assert.equal(a.getRollout(c.episodeId).annotations.length,3);assert.deepEqual(a.exportTraining(c.episodeId),training);
  }finally{a.close();}
});

test('annotation byte budget measures UTF-8 and rejected writes leave accounting unchanged',()=>{
  const a=limited({maxAnnotationBytesPerEpisode:5});try{
    const c=a.create('security-resource-fixture',setup);a.truncate(c.episodeId,'unicode test');
    a.submitReflection(c.episodeId,c.seats[0].token,'🧠');
    const bytes=a.db.prepare('SELECT bytes FROM episode_storage').get()!.bytes;
    resource(()=>a.submitReflection(c.episodeId,c.seats[1].token,'🧠'));
    assert.equal(count(a,'rollout_annotations'),1);assert.equal(a.db.prepare('SELECT bytes FROM episode_storage').get()!.bytes,bytes);
  }finally{a.close();}
});
