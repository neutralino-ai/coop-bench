import test from 'node:test';
import assert from 'node:assert/strict';
import { Authority } from '../src/authority.ts';
import { takeTime } from '../src/games/take-time.ts';
import type { GameAdapter } from '../src/types.ts';
const clockGame:GameAdapter={
  metadata:{...takeTime.metadata,id:'clock-fixture'},setup:()=>({remainingMs:1000,moves:0}),observe:s=>({...s}),
  decisionContext:s=>({moves:s.moves,ended:s.remainingMs===0}),activePlayers:s=>s.remainingMs?['p1']:[],
  legalActions:s=>s.remainingMs?[{type:'move',description:'test',schema:{},examples:[{type:'move'}]}]:[],
  step:s=>({...s,moves:s.moves+1}),advanceTime:(s,ms)=>({...s,remainingMs:Math.max(0,s.remainingMs-ms)}),
  outcome:s=>s.remainingMs===0?{kind:'loss',success:false,score:0,maxScore:1,reason:'official-timeout'}:null
};
test('server-only elapsed time advances without making every in-flight action stale; deadline ends before late move',()=>{
  let clock=1000;const a=new Authority(':memory:',[clockGame],'clock-test',()=>clock);
  try{
    const created=a.create('clock-fixture',{playerCount:3,scenarioId:'official-clock-1-1',seed:'clock'}),p=created.seats[0];
    const obs=a.observe(created.episodeId,p.token);clock+=200;
    const after=a.observe(created.episodeId,p.token);assert.equal(after.view.remainingMs,800);assert.equal(after.decisionToken,obs.decisionToken);
    clock+=200;const first=a.submit(created.episodeId,p.token,'move-1',{observationId:obs.observationId,decisionToken:obs.decisionToken,action:{type:'move'}});
    assert.equal(first.status,200);assert.equal(first.body.observation.view.moves,1);assert.equal(first.body.observation.view.remainingMs,600);
    clock+=601;const stale=first.body.observation;
    assert.equal(a.submit(created.episodeId,p.token,'too-late',{observationId:stale.observationId,decisionToken:stale.decisionToken,action:{type:'move'}}).status,409);
    const ended=a.observe(created.episodeId,p.token);assert.equal(ended.status,'completed');assert.equal(ended.outcome?.reason,'official-timeout');assert.equal(ended.view.moves,1);
    assert.equal(a.verifyReplay(created.episodeId).acceptedActions,1);
    assert.equal(a.exportTraining(created.episodeId).terminalTeamReward,0);
  }finally{a.close();}
});
