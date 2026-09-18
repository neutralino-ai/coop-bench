import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLocalEpisode, replayLocalAudit, mechanicalPolicy, fairScheduler } from '../src/local-runner.ts';
import { smokeAll } from '../src/smoke.ts';
import { legal } from '../src/common.ts';
import { hanabi } from '../src/games/hanabi.ts';
import { theGang } from '../src/games/the-gang.ts';
import { theGame } from '../src/games/the-game.ts';
import { theMind } from '../src/games/the-mind.ts';
import type { GameAdapter } from '../src/types.ts';

interface State { count: number; secret: Record<string,string>; seed: string; elapsed: number }
const fixture: GameAdapter<State> = {
  metadata: { id:'fixture', name:'Private runner fixture', players:[2,3], sources:[], scenarios:[{id:'base',name:'Fixture',provenance:'research-generated',description:'For runner tests.'},{id:'second',name:'Second fixture',provenance:'research-generated',description:'For enumeration tests.'}],rulesSummary:[],implementation:{fidelity:'research-adaptation',implemented:[],omitted:[],verifier:'exact',notes:[]} },
  setup:o=>({count:0,secret:{p1:'private-one',p2:'private-two'},seed:o.seed,elapsed:0}),
  observe:(s,p)=>({count:s.count,ownSecret:s.secret[p],elapsed:s.elapsed}),
  activePlayers:s=>s.count>=4?[]:[s.count%2?'p2':'p1'],
  legalActions:(s,p)=>s.count<4&&p===(s.count%2?'p2':'p1')?[legal('advance','Advance fixture.',{},undefined,[{type:'advance'}])]:[],
  step:(s,p,a)=>{ assert.equal(p,s.count%2?'p2':'p1'); assert.equal(a.type,'advance'); return {...s,count:s.count+1}; },
  outcome:s=>s.count>=4?{success:true,score:1,maxScore:1,reason:'done',details:{privateDiagnostic:s.secret.p2}}:null,
};
const setup={playerCount:2,scenarioId:'base',seed:'never-send-this-seed'};

test('Policies receive only frozen own observations and legal actions, with no audit secrets',async()=>{
  const inputs:any[]=[];
  const result=await runLocalEpisode(fixture,{setup,policy:input=>{
    assert.deepEqual(Object.keys(input).sort(),['gameId','legalActions','observation','observationHistory','playerId','scenarioId']);
    assert.equal(input.observation.ownSecret,input.playerId==='p1'?'private-one':'private-two');
    assert.ok(!JSON.stringify(input).includes(setup.seed)); assert.equal(Object.isFrozen(input.observation),true);
    assert.equal(Object.isFrozen(input.observationHistory),true);
    assert.ok(input.observationHistory.every(view=>view.ownSecret===input.observation.ownSecret&&Object.isFrozen(view)));
    assert.throws(()=>{(input.observation as any).ownSecret='tampered';});
    inputs.push(input); return {type:'advance'};
  }});
  assert.equal(inputs.length,4); assert.equal(result.terminated,true); assert.equal(result.audit.setup.seed,setup.seed);
  assert.ok(!JSON.stringify(result.trainingRows).includes(setup.seed)); assert.ok(!JSON.stringify(result.outcome).includes('privateDiagnostic'));
  for(const row of result.trainingRows) assert.equal(row.observation.ownSecret,row.playerId==='p1'?'private-one':'private-two');
});
test('Training transitions join the same player’s next decision and share only terminal team reward',async()=>{
  const result=await runLocalEpisode(fixture,{setup});
  const first=result.trainingRows[0]; assert.equal(first.playerId,'p1'); assert.equal(first.observation.count,0); assert.equal(first.nextObservation.count,2); assert.equal(first.reward,0); assert.equal(first.terminated,false);
  assert.deepEqual(first.observationHistory.map(view=>view.count),[0]); assert.deepEqual(first.nextObservationHistory.map(view=>view.count),[1,2]);
  const last=result.trainingRows.filter(row=>row.terminated); assert.equal(last.length,2); assert.ok(last.every(row=>row.reward===1&&row.nextObservation.count===4&&row.nextLegalActions.length===0));
});
test('Action budget and policy decline are truncations, never synthetic game losses',async()=>{
  const zero=await runLocalEpisode(fixture,{setup,maxActions:0}); assert.equal(zero.truncated,true); assert.equal(zero.outcome,null); assert.equal(zero.actions,0);
  const limited=await runLocalEpisode(fixture,{setup,maxActions:2}); assert.equal(limited.truncationReason,'action-budget'); assert.ok(limited.trainingRows.every(row=>row.truncated&&row.reward===null&&!row.terminated));
  let calls=0; const declined=await runLocalEpisode(fixture,{setup,policy:()=>++calls===3?null:{type:'advance'}});
  assert.equal(declined.truncationReason,'policy-declined'); assert.ok(declined.trainingRows.every(row=>row.truncated&&row.reward===null));
  assert.deepEqual(declined.trainingRows[0].nextObservationHistory.map(view=>view.count),[1,2]);
});

test('Own broadcast history preserves both transient public events between turns and at termination',async()=>{
  const transient:GameAdapter<any>={
    ...fixture,
    setup:()=>({count:0,lastEvent:null}),
    observe:(s,p)=>({lastEvent:s.lastEvent,ownSecret:`only-${p}`}),
    activePlayers:s=>s.count<6?[`p${s.count%3+1}`]:[],
    legalActions:(s,p)=>s.count<6&&p===`p${s.count%3+1}`?[legal('advance','',{},undefined,[{type:'advance'}])]:[],
    step:(s,p)=>({count:s.count+1,lastEvent:{actor:p,label:`public-${s.count+1}`}}),
    outcome:s=>s.count>=6?{success:true,score:1,reason:'done'}:null,
  };
  const p1Inputs:any[]=[];
  const result=await runLocalEpisode(transient,{setup:{...setup,playerCount:3},policy:input=>{
    if(input.playerId==='p1')p1Inputs.push(structuredClone(input));
    assert.ok(input.observationHistory.every(view=>view.ownSecret===`only-${input.playerId}`));
    return {type:'advance'};
  }});
  assert.equal(p1Inputs[1].observation.lastEvent.label,'public-3');
  assert.deepEqual(p1Inputs[1].observationHistory.map((view:any)=>view.lastEvent.label),['public-1','public-2','public-3']);
  const p1Rows=result.trainingRows.filter(row=>row.playerId==='p1');
  assert.deepEqual(p1Rows[0].nextObservationHistory,p1Inputs[1].observationHistory);
  assert.deepEqual(p1Rows[1].nextObservationHistory.map(view=>view.lastEvent.label),['public-4','public-5','public-6']);
  assert.equal(replayLocalAudit(transient,result.audit).verified,true);
});

test('Different numbers and contents of invisible submissions create indistinguishable own histories',async()=>{
  const hidden:GameAdapter<any>={
    ...fixture,
    setup:o=>({phase:0,commits:0,limit:o.config!.limit,secret:o.config!.secret,publicLabel:'initial'}),
    observe:(s,p)=>p==='p1'?{lastEvent:s.publicLabel}:{lastEvent:s.publicLabel,ownCommitCount:s.commits,ownSecret:s.secret},
    activePlayers:s=>s.phase===3?[]:[s.phase===1?'p2':'p1'],
    legalActions:(s,p)=>s.phase<3&&p===(s.phase===1?'p2':'p1')?[legal('advance','',{},undefined,[{type:'advance'}])]:[],
    step:s=>s.phase===0?{...s,phase:1,publicLabel:'opened'}:s.phase===1?{...s,commits:s.commits+1,phase:s.commits+1===s.limit?2:1}:{...s,phase:3,publicLabel:'finished'},
    outcome:s=>s.phase===3?{success:true,score:1,reason:'done'}:null,
  };
  const collected:any[][]=[];
  for(const config of [{limit:1,secret:'one-secret'},{limit:4,secret:'different-secret'}]){
    const p1Inputs:any[]=[];
    const result=await runLocalEpisode(hidden,{setup:{...setup,config},policy:input=>{
      if(input.playerId==='p1')p1Inputs.push(structuredClone(input));
      return {type:'advance'};
    }});
    collected.push(p1Inputs); assert.equal(replayLocalAudit(hidden,result.audit).verified,true);
    assert.deepEqual(p1Inputs[1].observationHistory,[{lastEvent:'opened'}]);
    assert.ok(!JSON.stringify(p1Inputs).includes(config.secret));
  }
  assert.deepEqual(collected[0],collected[1]);
});

test('Policy evaluation requires complete seat coverage or an explicit shared policy',async()=>{
  const advance=()=>({type:'advance'});
  await assert.rejects(runLocalEpisode(fixture,{setup,purpose:'policy-evaluation'}),/missing: p1, p2/);
  await assert.rejects(runLocalEpisode(fixture,{setup,purpose:'policy-evaluation',policies:{p1:advance}}),/missing: p2/);
  const covered=await runLocalEpisode(fixture,{setup,purpose:'policy-evaluation',policies:{p1:advance,p2:advance}});
  assert.equal(covered.terminated,true);
  const shared=await runLocalEpisode(fixture,{setup,purpose:'policy-evaluation',policy:advance,policies:{p1:advance}});
  assert.equal(shared.terminated,true);
  await assert.rejects(runLocalEpisode(fixture,{setup,policies:{p1:advance}}),/missing: p2/);
  const implicitEvaluation=await runLocalEpisode(fixture,{setup,policy:advance});
  assert.equal(implicitEvaluation.audit.purpose,'policy-evaluation');
  const smoke=await runLocalEpisode(fixture,{setup,purpose:'mechanical-smoke',policies:{p1:advance}});
  assert.equal(smoke.terminated,true);
  assert.equal(smoke.audit.purpose,'mechanical-smoke');
});
test('Evaluation schedules communication-only seats and retains their messages in teammates history',async()=>{
  const discussion:GameAdapter<any>={
    ...fixture,
    setup:()=>({progress:0,messages:[]}),
    observe:s=>structuredClone(s),
    activePlayers:s=>s.progress<2?['p1','p2']:[],
    legalActions:(s,p)=>s.progress>=2?[]:p==='p1'?[legal('play','Advance fixture.',{},undefined,[{type:'play'}])]:[legal('speak','Discuss fixture.',{text:{type:'string'}})],
    step:(s,p,a)=>p==='p1'?{...s,progress:s.progress+1}:{...s,messages:[...s.messages,{playerId:p,text:a.text}]},
    outcome:s=>s.progress===2?{success:true,score:1,reason:'fixture finished'}:null,
  };
  const policy=(input:any)=>input.playerId==='p1'?{type:'play'}:{type:'speak',text:'Coordinate before the next action.'};
  const evaluated=await runLocalEpisode(discussion,{setup,policy});
  assert.deepEqual(evaluated.trainingRows.map(row=>[row.playerId,row.action.type]),[['p1','play'],['p2','speak'],['p1','play']]);
  assert.ok(evaluated.trainingRows[2].observationHistory.some(view=>view.messages.some((message:any)=>message.text==='Coordinate before the next action.')));
  assert.equal(replayLocalAudit(discussion,evaluated.audit).verified,true);
  const mechanical=await runLocalEpisode(discussion,{setup,purpose:'mechanical-smoke',policy});
  assert.deepEqual(mechanical.trainingRows.map(row=>[row.playerId,row.action.type]),[['p1','play'],['p1','play']]);
});
test('Fair scheduling ignores action names, skips empty menus, and honors an explicit scheduler',async()=>{
  assert.equal(fairScheduler({activePlayerIds:['p1','p2','p3'],previousPlayerId:'p1',candidates:[{playerId:'p1',actionTypes:['play']},{playerId:'p2',actionTypes:[]},{playerId:'p3',actionTypes:['communicate']}]}),'p3');
  assert.equal(fairScheduler({activePlayerIds:['p1'],previousPlayerId:null,candidates:[{playerId:'p1',actionTypes:[]}]}),null);
  const calls:any[]=[];
  const result=await runLocalEpisode(theGame,{setup:{...setup,playerCount:3},maxActions:2,policy:input=>{calls.push(input.playerId);return {type:'chat',text:'Please leave the first pile for me.'};},scheduler:input=>{
    assert.equal(Object.isFrozen(input),true);assert.equal(Object.isFrozen(input.candidates),true);
    assert.deepEqual(Object.keys(input).sort(),['activePlayerIds','candidates','previousPlayerId']);return 'p2';
  }});
  assert.deepEqual(calls,['p2','p2']);assert.equal(result.actions,2);
});
test('The Game evaluation lets off-turn players speak before the current player plays again',async()=>{
  const result=await runLocalEpisode(theGame,{setup:{...setup,playerCount:3},purpose:'policy-evaluation',maxActions:4,policy:input=>input.observation.current&&input.observation.current!==input.playerId?{type:'chat',text:'Please leave the first pile for me.'}:mechanicalPolicy(input)});
  assert.deepEqual(result.trainingRows.map(row=>[row.playerId,row.action.type]),[['p1','choose_start'],['p2','chat'],['p3','chat'],['p1','play']]);
  assert.equal(result.trainingRows[3].observation.chat.length,2);
  assert.equal(replayLocalAudit(theGame,result.audit).verified,true);
});
test('Scored games remain scored and do not receive an invented binary reward',async()=>{
  const scored:GameAdapter<State>={...fixture,outcome:s=>s.count>=4?{kind:'score-only',success:false,score:17,maxScore:25,reason:'graded'}:null};
  const result=await runLocalEpisode(scored,{setup}); assert.equal(result.outcome?.kind,'score-only'); assert.ok(result.trainingRows.filter(row=>row.terminated).every(row=>row.reward===null));
});
test('Partition family conservatively groups a shared seed across game/scenario/player-count variations',async()=>{
  const first=await runLocalEpisode(fixture,{setup});
  const other={...fixture,metadata:{...fixture.metadata,id:'other-fixture'}};
  const second=await runLocalEpisode(other,{setup:{...setup,playerCount:3,scenarioId:'second'}});
  assert.equal(first.partitionFamily,second.partitionFamily); assert.ok(second.trainingRows.every(row=>row.partitionFamily===first.partitionFamily));
  const third=await runLocalEpisode(fixture,{setup:{...setup,seed:'different'}}); assert.notEqual(third.partitionFamily,first.partitionFamily);
});
test('A timed adapter requires an explicit logical clock; clock events replay exactly',async()=>{
  const timed:GameAdapter<State>={...fixture,advanceTime:(s,elapsedMs)=>({...s,elapsed:s.elapsed+elapsedMs}),outcome:s=>s.elapsed>=200?{success:false,score:0,reason:'official-timeout'}:null};
  await assert.rejects(runLocalEpisode(timed,{setup}),/explicit positive clockStepMs/);
  const result=await runLocalEpisode(timed,{setup,clockStepMs:100}); assert.equal(result.timeAdvances,2); assert.equal(result.actions,1); assert.equal(result.simulatedElapsedMs,200); assert.equal(result.outcome?.reason,'official-timeout'); assert.equal(result.truncated,false); assert.equal(replayLocalAudit(timed,result.audit).verified,true);
  assert.deepEqual(result.trainingRows[0].observationHistory.map(view=>view.elapsed),[0,100]);
  assert.deepEqual(result.trainingRows[0].nextObservationHistory.map(view=>view.elapsed),[100,200]);
});
test('Replay verifies observations, prefix/final hashes and rejects altered actions or seeds',async()=>{
  const result=await runLocalEpisode(fixture,{setup}); assert.equal(replayLocalAudit(fixture,result.audit).verified,true);
  const changed=structuredClone(result.audit); changed.setup.seed='changed'; assert.throws(()=>replayLocalAudit(fixture,changed),/Initial state/);
  const event=structuredClone(result.audit); const action=event.events.find(e=>e.kind==='action')!; if(action.kind==='action') action.action={type:'illegal'}; assert.throws(()=>replayLocalAudit(fixture,event));
  const observation=structuredClone(result.audit); const first=observation.events[0]; if(first.kind==='action') first.observationHash='bad'; assert.throws(()=>replayLocalAudit(fixture,observation),/observation/);
  const history=structuredClone(result.audit); const firstHistory=history.events[0]; if(firstHistory.kind==='action')firstHistory.observationHistoryHash='bad'; assert.throws(()=>replayLocalAudit(fixture,history),/observation history/);
});
test('Mechanical policy takes a free Gang chip and avoids message/reorder/stop loops',()=>{
  const input:any={gameId:'the-gang',scenarioId:'base',playerId:'p2',observation:{round:1,chips:[{p1:1,p2:null,p3:3}]},legalActions:[legal('chat','',{},undefined,[{type:'chat',text:'hi'}]),legal('claim','',{},undefined,[1,2,3].map(rank=>({type:'claim',rank})))]};
  assert.deepEqual(mechanicalPolicy(input),{type:'claim',rank:2});
  input.gameId='other'; input.legalActions=[legal('reorder','',{},undefined,[{type:'reorder',order:[0]}])]; assert.equal(mechanicalPolicy(input),null);
});
test('Built-in card games progress through legal actions with replay and no omniscient policy',async()=>{
  for(const game of [hanabi,theGang,theGame,theMind]) {
    const result=await runLocalEpisode(game,{setup:{playerCount:game.metadata.players[0],scenarioId:'base',seed:'local-smoke-check'},maxActions:500});
    assert.equal(result.terminated,true,game.metadata.id); assert.equal(replayLocalAudit(game,result.audit).verified,true);
    assert.ok(result.audit.events.filter(e=>e.kind==='action').every(e=>e.kind==='action'&&!['chat','reorder','stop'].includes(e.action.type)));
  }
});
test('Smoke enumerates every scenario/player combination, writes report and token-free examples',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'coop-bench-runner-'));
  try { const result=await smokeAll({outputDir:folder,examples:1,repeats:1},[fixture]); assert.equal(result.report.totals.combinations,4); assert.equal(result.report.totals.errors,0); const report=JSON.parse(await readFile(join(folder,'smoke-report.json'),'utf8')); assert.equal(report.exampleFiles.length,1); const example=JSON.parse(await readFile(join(folder,report.exampleFiles[0]),'utf8')); assert.equal(example.audit.privileged,true); assert.ok(!('playerTokens' in example)&&!('tokens' in example)); }
  finally { await rm(folder,{recursive:true,force:true}); }
});
