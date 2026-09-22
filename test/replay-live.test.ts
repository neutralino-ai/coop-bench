import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../web/replay-ui.js',import.meta.url),'utf8');
const refreshSource=source.slice(source.indexOf('  let liveBusy=false;'),source.indexOf('  window.CoopFocus='));
function setup(request:any){
 const buttons:any={},state:any={token:'session',session:1,detailRequest:1,followLive:true,index:5,rollout:{summary:{episodeId:'game',status:'active'},frames:Array(6).fill({})}};
 const document:any={hidden:false,body:{dataset:{view:'replay'}},addEventListener(){}};
 const context=vm.createContext({state,document,request,seats:{},load:async()=>{},renderHeader(){},renderTimeline(){},renderFrame(){},setInterval(){},
  addButton:(id:string,label:string,fn:any)=>buttons[id]={textContent:label,onclick:fn,setAttribute(){}}});
 vm.runInContext(refreshSource,context);return {state,buttons,context,refresh:()=>vm.runInContext('refreshReplay()',context)};
}
const next=(status='active')=>({summary:{episodeId:'game',status},frames:Array(8).fill({})});
test('live follow advances automatically, survives final frame and ignores hidden library checkbox',async()=>{
 const x=setup(async()=>next());await x.refresh();assert.equal(x.state.index,7);
 x.state.rollout.summary.status='active';const y=setup(async()=>next('completed'));await y.refresh();assert.equal(y.state.index,7);assert.equal(y.state.rollout.summary.status,'completed');
});
test('a historical selection while an update is in flight stays selected; live button resumes follow',async()=>{
 let resolve:any;const x=setup(()=>new Promise(r=>resolve=r));const pending=x.refresh();x.state.followLive=false;x.state.index=2;resolve(next());await pending;
 assert.equal(x.state.index,2);x.buttons['replay-follow'].onclick();assert.equal(x.state.followLive,true);assert.equal(x.state.index,7);resolve(next());
});
test('background and stale replay responses cannot change the visible replay',async()=>{
 let calls=0,resolve:any;const x=setup(()=>{calls++;return new Promise(r=>resolve=r)});
 x.context.document.hidden=true;await x.refresh();assert.equal(calls,0);x.context.document.hidden=false;
 const pending=x.refresh();x.state.detailRequest++;resolve(next());await pending;assert.equal(x.state.index,5);
});
test('slow trace loading cannot hold the next board refresh',async()=>{
 let count=0;const x=setup(async()=>{count++;return next()});x.context.load=()=>new Promise(()=>{});
 await x.refresh();await x.refresh();assert.equal(count,2);
});

test('coding agent prompt asks for truthful self naming across harnesses',()=>{
 const context=vm.createContext({window:{},URL});vm.runInContext(readFileSync(new URL('../web/room-seats.js',import.meta.url),'utf8'),context);
 const prompt=context.window.CoopRoomSeats.prompt({apiUrl:'https://example.test/api/v1',roomId:'room',playerId:'p1',seatToken:'synthetic-seat'});
 assert.match(prompt,/Lili \(codex-gpt-6-astra-high\)/);assert.match(prompt,/DeepSeek/);assert.match(prompt,/unknown/);assert.doesNotMatch(prompt,/"name":"Claude"/);
 assert.match(prompt,/本席可见信息/);assert.match(prompt,/\/player.md/);
});
