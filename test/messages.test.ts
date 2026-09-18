import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Authority } from '../src/authority.ts';
import { takeTime } from '../src/games/take-time.ts';

const setup={playerCount:3,scenarioId:'official-clock-1-1',seed:'private-message-fixture'};
const rejects=(run:()=>unknown,code:string)=>assert.throws(run,(error:any)=>error.code===code);
const message=(sequence=0,extra={})=>({sequence,messageId:`msg-${sequence}`,message:{role:'assistant',content:[{type:'text',text:'Client captured answer'},{type:'reasoning',text:'Explicitly supplied provider field'}],tool_calls:[{id:'call-test',type:'function',function:{name:'observe',arguments:'{}'}}]},kind:'model-output',reasoningAvailability:'provided',clientAt:'2026-09-17T08:00:00.000Z',tokenUsage:{output_tokens:12,output_tokens_details:{reasoning_tokens:5}},...extra});
const evidence=(a:Authority,id:string)=>Object.fromEntries(['episodes','events','views','visible_updates','observations','observation_cache','commands','clocks','rollout_frames','episode_storage'].map(table=>[table,a.db.prepare(`SELECT * FROM ${table}`).all()]));

test('private active-game messages retain complete structured provider data without changing any game evidence or broadcasting',()=>{
  const a=new Authority(':memory:',[takeTime],'messages-test');try{
    const c=a.create('take-time',setup),[p,q]=c.seats,own=a.observe(c.episodeId,p.token),other=a.observe(c.episodeId,q.token),before=evidence(a,c.episodeId);
    const input=message(0,{observationId:own.observationId,provider:'fixture',model:'actual-client-label'}),saved=a.appendMessage(c.episodeId,p.token,input);
    assert.deepEqual(saved.message,input.message);assert.deepEqual(saved.tokenUsage,input.tokenUsage);
    assert.equal(saved.provenance,'client-supplied-unverified');assert.equal(saved.playerId,'p1');assert.ok(saved.serverReceivedAt);
    assert.deepEqual(evidence(a,c.episodeId),before);assert.deepEqual(a.observe(c.episodeId,q.token),other);
    assert.deepEqual(a.listSeatMessages(c.episodeId,q.token).messages,[]);
    assert.equal('messageCount' in a.listSeatMessages(c.episodeId,q.token).retention,false);
    rejects(()=>a.appendMessage(c.episodeId,p.token,message(1,{observationId:other.observationId})),'INVALID_REQUEST');
    rejects(()=>a.appendMessage(c.episodeId,'operator',message()),'UNAUTHORIZED');
    rejects(()=>a.appendMessage(c.episodeId,p.token,message(1,{playerId:'p2'})),'INVALID_REQUEST');
    assert.equal(a.listSeatMessages(c.episodeId,p.token).messages.length,1);
  }finally{a.close();}
});

test('sequence and messageId bind retries exactly; gaps, conflicts and duplicate IDs cannot overwrite messages',()=>{
  const a=new Authority(':memory:',[takeTime],'messages-test');try{
    const c=a.create('take-time',setup),p=c.seats[0];
    rejects(()=>a.appendMessage(c.episodeId,p.token,message(1)),'MESSAGE_SEQUENCE_CONFLICT');
    const first=a.appendMessage(c.episodeId,p.token,message());
    assert.deepEqual(a.appendMessage(c.episodeId,p.token,{...message(),message:{...message().message,tool_calls:message().message.tool_calls}}),first);
    rejects(()=>a.appendMessage(c.episodeId,p.token,message(0,{message:{role:'assistant',content:'different'}})),'IDEMPOTENCY_CONFLICT');
    rejects(()=>a.appendMessage(c.episodeId,p.token,message(1,{messageId:'msg-0'})),'MESSAGE_ID_CONFLICT');
    for(let i=1;i<4;i++)a.appendMessage(c.episodeId,p.token,message(i));
    const page=a.listSeatMessages(c.episodeId,p.token,-1,2);assert.deepEqual(page.messages.map(m=>m.sequence),[0,1]);assert.equal(page.nextAfter,1);assert.equal(page.hasMore,true);
    const next=a.listSeatMessages(c.episodeId,p.token,page.nextAfter,2);assert.deepEqual(next.messages.map(m=>m.sequence),[2,3]);assert.equal(next.hasMore,false);
    assert.equal(a.listSeatMessages(c.episodeId,p.token,9).nextAfter,9);
    assert.throws(()=>a.db.prepare("UPDATE agent_messages SET payload='{}'").run(),/immutable/);
    assert.throws(()=>a.db.prepare('DELETE FROM agent_messages').run(),/retained indefinitely/);
  }finally{a.close();}
});

test('client message upload never bypasses the silence rule and cannot advance a timed game clock',()=>{
  let clock=0;const a=new Authority(':memory:',[takeTime],'messages-test',()=>clock);try{
    const c=a.create('take-time',setup),p=c.seats[0],beforeLook=a.observe(c.episodeId,p.token);
    const looked=a.submit(c.episodeId,p.token,'look',{observationId:beforeLook.observationId,decisionToken:beforeLook.decisionToken,action:{type:'look_hand'}});assert.equal(looked.status,200);
    const before=evidence(a,c.episodeId);clock=120000;
    a.appendMessage(c.episodeId,p.token,message(0,{message:{role:'assistant',content:'I privately log my cards. This is not a speak action.'},kind:'model-output'}));
    assert.deepEqual(evidence(a,c.episodeId),before);
    const o=a.observe(c.episodeId,p.token),speak=a.submit(c.episodeId,p.token,'forbidden-speech',{observationId:o.observationId,decisionToken:o.decisionToken,action:{type:'speak',text:'not permitted after look'}});
    assert.equal(speak.status,409);assert.equal(a.listSeatMessages(c.episodeId,p.token).messages.length,1);
    const q=a.observe(c.episodeId,c.seats[1].token);assert.equal(JSON.stringify(q).includes('privately log'),false);
  }finally{a.close();}
});

test('terminal sealing states captured scope honestly and is immutable while exact retries remain readable',()=>{
  const a=new Authority(':memory:',[takeTime],'messages-test');try{
    const c=a.create('take-time',setup),p=c.seats[0],input=message(),seal={scope:'Complete provider request and response messages captured by this client.',completeness:'partial',reasoningAvailability:'not-provided',unavailable:['Private reasoning not returned by provider']};
    a.appendMessage(c.episodeId,p.token,input);rejects(()=>a.completeMessages(c.episodeId,p.token,seal),'EPISODE_ACTIVE');
    a.truncate(c.episodeId,'fixture ends');a.appendMessage(c.episodeId,p.token,message(1,{message:{role:'tool',content:{terminal:true}}}));
    const saved=a.completeMessages(c.episodeId,p.token,seal);assert.equal(saved.lastSequence,1);assert.equal(saved.completeness,'partial');assert.equal(saved.provenance,'client-supplied-unverified');
    assert.deepEqual(a.completeMessages(c.episodeId,p.token,seal),saved);assert.equal(a.appendMessage(c.episodeId,p.token,input).sequence,0);
    rejects(()=>a.appendMessage(c.episodeId,p.token,message(2)),'MESSAGES_SEALED');
    rejects(()=>a.completeMessages(c.episodeId,p.token,{...seal,completeness:'complete'}),'IDEMPOTENCY_CONFLICT');
    assert.deepEqual(a.listSeatMessages(c.episodeId,p.token).completion,saved);
    const summary=a.listRolloutMessages(c.episodeId) as any;assert.equal(summary.seats[0].messageCount,2);assert.equal(summary.seats[1].completion,null);
  }finally{a.close();}
});

test('quotas reject new message writes without deleting evidence or changing gameplay, and validation bounds structured content',()=>{
  const a=new Authority(':memory:',[takeTime],'messages-test',Date.now,{maxMessagesPerSeat:1,maxMessageStoredBytesTotal:1000});try{
    const c=a.create('take-time',setup),p=c.seats[0],input=message(),saved=a.appendMessage(c.episodeId,p.token,input),before=evidence(a,c.episodeId);
    rejects(()=>a.appendMessage(c.episodeId,p.token,message(1)),'RESOURCE_LIMIT');
    rejects(()=>a.appendMessage(c.episodeId,c.seats[1].token,message(0,{message:{role:'user',content:'x'.repeat(800)}})),'RESOURCE_LIMIT');
    assert.deepEqual(a.appendMessage(c.episodeId,p.token,input),saved);assert.deepEqual(evidence(a,c.episodeId),before);
    assert.equal(a.retention().messages.messageCount,1);assert.equal(a.retention().messages.automaticDeletion,false);
    for(const extra of [{sequence:-1},{messageId:' '},{message:{content:'missing role'}},{clientAt:'yesterday'},{kind:'speak'},{tokenUsage:[]},{reasoningAvailability:'server-verified'},{provider:'bad\nheader'}])rejects(()=>a.appendMessage(c.episodeId,p.token,message(1,extra)),'INVALID_REQUEST');
    rejects(()=>a.appendMessage(c.episodeId,p.token,message(1,{message:{role:'user',content:'x'.repeat(48*1024)}})),'TOO_LARGE');
    rejects(()=>a.appendMessage(c.episodeId,p.token,message(1,{message:JSON.parse('{"role":"user","__proto__":{}}')})),'INVALID_REQUEST');
    rejects(()=>a.listSeatMessages(c.episodeId,p.token,-2),'INVALID_REQUEST');rejects(()=>a.listSeatMessages(c.episodeId,p.token,-1,101),'INVALID_REQUEST');
  }finally{a.close();}
});

test('messages and accounting survive new builds and share an atomic storage budget across SQLite connections',()=>{
  const dir=mkdtempSync(join(tmpdir(),'coop-message-store-')),file=join(dir,'episodes.sqlite');
  let a=new Authority(file,[takeTime],'build-a',Date.now,{maxMessageStoredBytesTotal:1000}),b:Authority|undefined;
  try{
    const c=a.create('take-time',setup),p=c.seats[0],input=message(),first=a.appendMessage(c.episodeId,p.token,input);
    b=new Authority(file,[takeTime],'build-a',Date.now,{maxMessageStoredBytesTotal:1000});
    rejects(()=>b!.appendMessage(c.episodeId,c.seats[1].token,message(0,{message:{role:'tool',content:'x'.repeat(800)}})),'RESOURCE_LIMIT');
    b.close();b=undefined;const used=a.retention().messages.storedBytes;a.close();a=new Authority(file,[],'build-b',Date.now,{maxMessageBytes:1,maxMessageStoredBytesTotal:1});
    assert.deepEqual(a.appendMessage(c.episodeId,p.token,input),first);assert.equal(a.retention().messages.storedBytes,used);
    rejects(()=>a.appendMessage(c.episodeId,p.token,message(1)),'RESOURCE_LIMIT');
    assert.deepEqual(a.listSeatMessages(c.episodeId,p.token).messages[0].message,input.message);
    rejects(()=>a.observe(c.episodeId,p.token),'BUILD_MISMATCH');
  }finally{b?.close();a.close();for(const name of readdirSync(dir))unlinkSync(join(dir,name));rmdirSync(dir);}
});
