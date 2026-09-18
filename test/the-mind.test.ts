import test from 'node:test';
import assert from 'node:assert/strict';
import { theMind, type MindState } from '../src/games/the-mind.ts';
const setup=(n=3)=>theMind.setup({playerCount:n,seed:'mind-tests',scenarioId:'base'});
function ready(s:MindState) { for(const p of s.players) if(!s.ready.includes(p)) s=theMind.step(s,p,{type:'ready'}); return s; }
test('The Mind correct levels/lives, hidden hands, no turn order',()=>{
  for(const n of [2,3,4]) { let s=setup(n); assert.equal(s.maxLevel,n===2?12:n===3?10:8); assert.equal(s.lives,n); s=ready(s); assert.deepEqual(theMind.activePlayers(s),s.players); const v=theMind.observe(s,'p1'); assert.ok(!('hands' in v)&&!('rng' in v)); }
});
test('The Mind wrong play removes all skipped cards for exactly one life and refocuses',()=>{
  let s=setup(); s.hands={p1:[10,20],p2:[15,40],p3:[30,60]}; s=ready(s); s=theMind.step(s,'p3',{type:'play',card:30});
  assert.equal(s.lives,2); assert.deepEqual(s.hands.p1,[]); assert.deepEqual(s.hands.p2,[40]); assert.equal(s.phase,'focus');
  assert.throws(()=>theMind.step(s,'p2',{type:'play',card:40})); s=ready(s); s=theMind.step(s,'p2',{type:'stop'}); assert.equal(s.phase,'focus');
});
test('The Mind cannot skip own lowest; unanimous star discards lowest once and prevents stale consent',()=>{
  let s=setup(); s.hands={p1:[10,50],p2:[20,60],p3:[30,70]}; s=ready(s);
  assert.throws(()=>theMind.step(s,'p1',{type:'play',card:50}));
  s=theMind.step(s,'p1',{type:'star_vote',agree:true}); s=theMind.step(s,'p2',{type:'play',card:20}); assert.deepEqual(s.starVotes,[]); s=ready(s);
  for(const p of s.players) s=theMind.step(s,p,{type:'star_vote',agree:true});
  assert.equal(s.stars,0); assert.deepEqual(s.hands,{p1:[],p2:[],p3:[70]}); assert.equal(s.phase,'focus');
});
test('The Mind losing last life precedes a level completion',()=>{
  let s=setup(); s.hands={p1:[10],p2:[20],p3:[30]}; s.lives=1; s=ready(s); s=theMind.step(s,'p3',{type:'play',card:30});
  assert.equal(theMind.outcome(s)?.success,false); assert.equal(s.completed,0); assert.equal(s.phase,'ended');
});
test('The Mind a throwing star can be agreed during concentration before play',()=>{
  let s=setup(); for(const p of s.players) s=theMind.step(s,p,{type:'star_vote',agree:true});
  assert.equal(s.level,2); assert.equal(s.completed,1); assert.equal(s.stars,0); assert.equal(s.phase,'focus');
});
test('The Mind full level sequence reshuffles and awards capped stars/lives',()=>{
  let s=setup(2); while(s.phase!=='ended') { if(s.phase==='focus') { s=ready(s); continue; } const p=s.players.filter(p=>s.hands[p].length).sort((a,b)=>s.hands[a][0]-s.hands[b][0])[0]; s=theMind.step(s,p,{type:'play',card:s.hands[p][0]}); }
  assert.equal(theMind.outcome(s)?.success,true); assert.equal(s.completed,12); assert.equal(s.lives,5); assert.equal(s.stars,3);
});
