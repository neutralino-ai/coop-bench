import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PlayerRuntime} from '../client/runtime.mjs';

const roomId='01234567-0123-0123-0123-012345678901';
const event={type:'hint',player:'p2',target:'p1',kind:'color',value:'red',touched:[1,3]};
const update=(seq:number)=>({seq,preparedAt:'2026-09-21T10:00:00Z',status:'active',view:{lastEvent:event,hands:{p1:[{possibleColors:['red'],possibleValues:[1,2]}]}}});

test('paginated visible history survives context acknowledgement and seat restart without credentials or duplicate entries',async()=>{
 const config={apiUrl:'http://127.0.0.1:8788/api/v1',roomId,playerToken:'private-seat-fixture',directory:mkdtempSync(join(tmpdir(),'coop-visible-history-'))};
 const observed={episodeId:'fixture',playerId:'p1',observationId:'same-head',decisionToken:'private-decision',status:'truncated',view:update(1).view,legalActions:[]};
 const cursors:string[]=[];
 let runtime=new PlayerRuntime(config,{fetchImpl:async(url:string)=>{
   let body:any={};
   if(url.includes('/rooms/'))body={roomId,gameId:'hanabi',status:'active',episodeId:'fixture'};
   if(url.includes('/wait?')||url.includes('/observation?')){
     const after=new URL(url).searchParams.get('after')!;cursors.push(after);
     body={...observed,updateCursor:after==='0'?1:2,nextCursor:after==='0'?1:2,hasMore:after==='0',updates:[update(after==='0'?1:2)]};
   }
   return Response.json(body);
 }});
 let delivered:any,acknowledged:Promise<void>|undefined;
 runtime.on('state',()=>{if(runtime.observation&&!runtime.observation.hasMore&&!acknowledged){delivered=runtime.context();acknowledged=runtime.recordModelRequest({fixture:true},{observationId:'same-head'});}});
 try{
   await runtime.run();assert.deepEqual(cursors,['0','1']);
   const first=runtime.snapshot();assert.deepEqual(first.visibleHistory.map((u:any)=>u.seq),[1,2]);
   assert.deepEqual(first.visibleHistory[0].event,event);
   assert.deepEqual(delivered.observation.updates.map((u:any)=>u.seq),[1,2]);
   await acknowledged;
   assert.deepEqual(runtime.context().observation.updates,[]);
   assert.equal(runtime.snapshot().visibleHistory.length,2);
   assert.ok(!JSON.stringify(first).includes('private-'));
 }finally{await runtime.close();}
 runtime=new PlayerRuntime(config);
 try{assert.deepEqual(runtime.snapshot().visibleHistory.map((u:any)=>u.seq),[1,2]);}
 finally{await runtime.close();}
});

test('existing human pending updates populate history on upgrade without consuming model input',async()=>{
 const config={apiUrl:'http://127.0.0.1:8788/api/v1',roomId,playerToken:'private-seat-fixture',directory:mkdtempSync(join(tmpdir(),'coop-history-upgrade-'))};
 let runtime=new PlayerRuntime(config);runtime.put('pendingUpdates',[update(1),update(2)]);await runtime.close();
 runtime=new PlayerRuntime(config);
 try{assert.equal(runtime.snapshot().visibleHistory.length,2);assert.equal(runtime.get('pendingUpdates').length,2);}
 finally{await runtime.close();}
});
