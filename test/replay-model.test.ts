import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context=vm.createContext({});
vm.runInContext(readFileSync(new URL('../web/replay-model.js',import.meta.url),'utf8'),context);
const R=context.CoopReplay;
test('automatic fallback is labeled as server action and has no invented player reasoning',()=>{
 const frame={kind:'accepted',automatic:{source:'server-timeout'},action:{type:'discard',index:0}};
 assert.equal(R.actionText(frame),'超时默认动作 · 弃掉第 1 张牌');
 assert.deepEqual(Array.from(R.linkedMessages([{playerId:'p1',observationId:'old',sequence:0}],frame,'p1')),[]);
});
test('copied player prompt explains authoritative deadline, default action and stale action recovery',()=>{
 const ctx=vm.createContext({window:{},URL});vm.runInContext(readFileSync(new URL('../web/room-seats.js',import.meta.url),'utf8'),ctx);
 const prompt=ctx.window.CoopRoomSeats.prompt({apiUrl:'https://example.test/api/v1',roomId:'room',playerId:'p1',seatToken:'synthetic-secret'});
 for(const part of ['3 分钟','control.timeoutAction','default-action-v1','超时后重新 wait','synthetic-secret','https://example.test/player.md'])assert.ok(prompt.includes(part),part);
});
const hidden={id:'old-card',index:0,possibleColors:['red','blue'],possibleValues:[1,2]};
function fixture(){
 const own={view:{hands:{p1:[{...hidden}],p2:[{id:'peer-card',color:'red',value:2}]}}};
 const peer={view:{hands:{p1:[{...hidden,color:'blue',value:1}],p2:[{id:'peer-card'}]}}};
 return {summary:{gameId:'hanabi'},players:['p1','p2'],frames:[
  {seq:0,views:{p1:own,p2:peer}},
  {seq:1,playerId:'p1',action:{type:'play',index:0},observed:{...own,observationId:'obs-before'},views:{p1:{view:{hands:{p1:[{id:'drawn'}]}}},p2:{view:{hands:{p1:[{id:'drawn',color:'red',value:5}]}}}}}]};
}
test('audit combines same-time peer cards while preserving exact hidden actor input; never uses draws or terminal hands',()=>{
 const data=fixture(),before=JSON.stringify(data),snap=R.snapshot(data,1),p=snap.players[0];
 assert.equal(p.actual[0].color,'blue');assert.equal(p.actual[0].value,1);
 assert.equal(p.hand[0].color,undefined);assert.equal(p.observation.observationId,'obs-before');
 assert.equal(p.actual[0].id,'old-card');assert.equal(JSON.stringify(data),before);
 assert.equal(snap.players[1].decision,null);assert.equal(snap.players[0].decision.seq,1);
});
test('missing and stale historic evidence is not filled by future cards or index; conflicting projections remain unknown',()=>{
 const data=fixture();delete data.frames[0].views.p2;
 assert.equal(R.snapshot(data,1).players[0].actual[0].value,undefined);
 const stale=fixture();stale.frames[0].views.p2.view.hands.p1[0].id='different-card';
 assert.equal(R.snapshot(stale,1).players[0].actual[0].value,undefined);
 const conflict:any=fixture();conflict.frames[0].views.p3={view:{hands:{p1:[{...hidden,color:'red',value:5}]}}};
 assert.equal(R.snapshot(conflict,1).players[0].actual[0].value,undefined);
});
test('last decision is bounded by playback position and not a later turn',()=>{
 const data:any=fixture();data.frames.push({...data.frames[1],seq:2,playerId:'p2',decisionSummary:'future'});
 assert.equal(R.snapshot(data,1).players[1].decision,null);
 assert.equal(R.snapshot(data,2).players[0].decision.seq,1);
 assert.equal(R.snapshot(data,2).players[1].decision.seq,2);
});
test('messages bind only by matching seat and observation ID, never by adjacent timestamp/request',()=>{
 const frame=fixture().frames[1];const entries=[
  {playerId:'p1',sequence:3,observationId:'obs-before'},
  {playerId:'p2',sequence:1,observationId:'obs-before'},
  {playerId:'p1',sequence:2,observationId:'future'},
  {playerId:'p1',sequence:0,requestId:'obs-before'},
  {playerId:'p1',sequence:1,observationId:'obs-before'},
 ];
 assert.equal(JSON.stringify(R.linkedMessages(entries,frame,'p1').map(m=>m.sequence)),'[1,3]');
 assert.equal(R.linkedMessages(entries,{observed:{}},'p1').length,0);
});
test('reasoning distinguishes uploaded output, summary and opaque fields; input/tool quotations are excluded',()=>{
 const entries=[
  {kind:'model-input',message:{role:'user',reasoning_content:'quoted input'}},
  {kind:'tool-result',message:{reasoning_content:'tool output'}},
  {kind:'model-output',message:{role:'assistant',reasoning_content:'provider text'}},
  {kind:'model-output',message:{raw:{choices:[{message:{role:'assistant',reasoning_content:'provider text'}}]}}},
  {kind:'model-output',message:{raw:{output:[{type:'reasoning',summary:[{type:'summary_text',text:'summary only'}],encrypted_content:'opaque'}]}}},
  {kind:'model-output',message:{content:[{type:'redacted_thinking',data:'redacted'},{type:'thinking',thinking:'another provider'}]}},
 ];
 const result=R.reasoning(entries);assert.equal(result.length,3);
 assert.equal(result[0].text,'provider text');assert.equal(result[1].label,'上传的推理摘要');assert.equal(result[2].text,'another provider');
 assert.ok(!JSON.stringify(result).includes('opaque'));assert.ok(!JSON.stringify(result).includes('quoted input'));
});
test('Take Time backs stay unknown during discussion and generic private hands use only the recorded view',()=>{
 const data={summary:{gameId:'take-time'},players:['p1'],frames:[{views:{p1:{view:{hand:null,cardBacks:{p1:{hand:['solar','lunar']}}}}}}]};
 const p=R.snapshot(data,0).players[0];assert.equal(p.actual,null);assert.equal(p.exact,false);
 assert.equal(p.observation.view.cardBacks.p1.hand.length,2);
});

test('Responses plain reasoning appears as original reasoning rather than a summary',()=>{
 const result=R.reasoning([{kind:'model-output',message:{raw:{output:[{type:'reasoning',content:[{type:'reasoning_text',text:'Synthetic Responses reasoning.'}]}]}}}]);
 assert.equal(result.length,1);assert.equal(result[0].text,'Synthetic Responses reasoning.');assert.equal(result[0].label,'上传的 reasoning 原文');
});
