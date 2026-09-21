import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('../ios/ios-bridge.js',import.meta.url),'utf8');
function bridge(role){
 const sent=[];
 const window={__coopRole:role,webkit:{messageHandlers:{coop:{postMessage:message=>sent.push(message)}}},addEventListener(){}};
 vm.runInNewContext(script,{window,atob:text=>Buffer.from(text,'base64').toString('binary'),Uint8Array});
 return {window,sent};
}
test('iOS player bridge exposes only seat commands and passes structured failures',async()=>{
 const {window,sent}=bridge('player');
 assert.equal(window.coopDesktop,undefined);assert.ok(Object.isFrozen(window.coopPlayer));
 const result=window.coopPlayer.command('act',{observationId:'own-observation',action:{type:'discard',index:0}});
 assert.equal(sent[0].name,'act');assert.equal(sent[0].input.observationId,'own-observation');
 window.__coopReply(sent[0].id,null,{code:'STALE_OBSERVATION',message:'Refresh observation',status:409});
 await assert.rejects(result,{code:'STALE_OBSERVATION',status:409});
});
test('iOS host bridge preserves binary and empty response bodies without exposing credentials',async()=>{
 const {window,sent}=bridge('host');
 assert.equal(window.coopPlayer,undefined);assert.equal(window.coopDesktop.token,undefined);
 for(const bytes of [Buffer.from([0,127,128,255]),Buffer.alloc(0)]){
  const request=window.coopDesktop.request({path:'/api/v1/rollouts'});
  window.__coopReply(sent.at(-1).id,{status:200,headers:{},bodyBase64:bytes.toString('base64')},null);
  const response=await request;assert.deepEqual([...response.bytes],[...bytes]);assert.equal(response.bodyBase64,undefined);
 }
});
test('iOS state subscriptions can be removed when a seat view closes',()=>{
 const {window}=bridge('player');let count=0;
 const off=window.coopPlayer.onState(()=>count++);
 window.__coopEvent('state',{status:'waiting'});off();window.__coopEvent('state',{status:'ended'});
 assert.equal(count,1);
});
