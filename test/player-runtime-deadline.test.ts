import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlayerRuntime } from '../client/runtime.mjs';

const roomId='01234567-0123-0123-0123-012345678901';
const observation=(control:any)=>({episodeId:'fixture-episode',playerId:'p1',observationId:'fixture-observation',decisionToken:'fixture-decision',status:'active',
  view:{},legalActions:[{type:'play'}],outcome:null,updateCursor:0,updates:[],...(control===undefined?{}:{control:{required:true,...control}})});

test('exhausted model failures stop automatic decisions instead of retrying each polled observation',async()=>{
 const runtime=new PlayerRuntime({apiUrl:'http://127.0.0.1:8788/api/v1',roomId,directory:mkdtempSync(join(tmpdir(),'coop-stopped-model-'))});
 let calls=0;const stopped=Promise.withResolvers<string>();runtime.on('agent-stopped',(code:string)=>stopped.resolve(code));
 runtime.attachAgent({async decide(){calls++;throw Object.assign(Error('Synthetic failure'),{code:'MODEL_TOOL_FORMAT'});}});
 try{
  runtime.observation=observation({deadlineAt:Date.now()+600000});runtime.emit('observation');assert.equal(await stopped.promise,'MODEL_TOOL_FORMAT');
  await new Promise(resolve=>setImmediate(resolve));runtime.observation={...runtime.observation,observationId:'new-poll'};runtime.emit('observation');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 }finally{await runtime.close();}
});

test('runner decision signals use remaining server deadlines, including legacy windows and the episode cap',async t=>{
  const start=1700000000000;let now=start;const timers:number[]=[];
  t.mock.method(Date,'now',()=>now);
  t.mock.method(AbortSignal,'timeout',(ms:number)=>{timers.push(ms);return new AbortController().signal;});
  const cases=[
    {name:'default ten-minute window',control:{deadlineAt:start+600000,episodeDeadlineAt:start+3600000},elapsed:0,expected:600000},
    {name:'custom ninety-second window',control:{deadlineAt:start+90000,episodeDeadlineAt:start+3600000},elapsed:0,expected:90000},
    {name:'legacy sixty-second deadline',control:{deadlineAt:start+60000},elapsed:0,expected:60000},
    {name:'reconnect keeps original absolute deadline',control:{deadlineAt:start+600000,episodeDeadlineAt:start+3600000},elapsed:120000,expected:480000},
    {name:'episode ends before required window',control:{deadlineAt:start+600000,episodeDeadlineAt:start+40000},elapsed:0,expected:40000},
    {name:'official-clock phase has only episode deadline',control:{deadlineAt:null,episodeDeadlineAt:start+90000},elapsed:0,expected:90000},
    {name:'expired budget aborts promptly',control:{deadlineAt:start+600000,episodeDeadlineAt:start-1},elapsed:0,expected:1},
    {name:'older response without deadlines uses ten-minute fallback',control:undefined,elapsed:0,expected:600000},
  ];
  for(const entry of cases){
    now=start+entry.elapsed;const runtime=new PlayerRuntime({apiUrl:'http://127.0.0.1:8788/api/v1',roomId,directory:mkdtempSync(join(tmpdir(),'coop-runner-deadline-'))});
    try{
      runtime.observation=observation(entry.control);
      const deciding=Promise.withResolvers<void>();
      runtime.attachAgent({async decide(_context:any,{signal}:any){assert.equal(signal.aborted,false);deciding.resolve();return {wait:true};}});
      runtime.emit('observation');await deciding.promise;
      assert.equal(timers.at(-1),entry.expected,entry.name);
    }finally{await runtime.close();}
  }
});

test('runner measures deadlines against server time when the local clock is skewed',async t=>{
  const localTime=1700000000000,serverTime=localTime+120000,timers:number[]=[],warnings:string[]=[];
  t.mock.method(Date,'now',()=>localTime);
  t.mock.method(AbortSignal,'timeout',(ms:number)=>{timers.push(ms);return new AbortController().signal;});
  const active=observation({deadlineAt:serverTime+600000,episodeDeadlineAt:serverTime+90000});
  const terminal={...active,observationId:'terminal-observation',status:'truncated',legalActions:[]};
  const runtime=new PlayerRuntime({apiUrl:'http://127.0.0.1:8788/api/v1',roomId,transport:'sse',directory:mkdtempSync(join(tmpdir(),'coop-runner-clock-'))},{
    fetchImpl:async(url:string)=>{
      if(url.includes('/events?'))return new Response('data: '+JSON.stringify({serverTime,observation:active})+'\n\n'+'data: '+JSON.stringify({serverTime,observation:terminal})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
      const body=url.includes('/rooms/')?{roomId,gameId:'fixture',status:'active',episodeId:'fixture-episode'}:{};
      return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
    },
  });
  let decisionMs:number|undefined;
  runtime.on('agent-warning',(warning:string)=>warnings.push(warning));
  runtime.attachAgent({async decide(){decisionMs=timers.at(-1);return {wait:true};}});
  try{
    await runtime.run();
    assert.equal(runtime.snapshot().clockOffsetMs,120000);
    assert.equal(decisionMs,90000,'The server episode deadline leaves 90 seconds despite a local clock two minutes behind.');
    assert.deepEqual(warnings,[]);
  }finally{await runtime.close();}
});
