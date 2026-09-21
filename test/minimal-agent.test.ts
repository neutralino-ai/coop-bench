import test from 'node:test';
import assert from 'node:assert/strict';
import {MinimalAgent} from '../client/minimal-agent.mjs';

function recorder(){
 const state=new Map(),captures:any[]=[];
 return {captures,runtime:{get:(key:string)=>structuredClone(state.get(key)),put:(key:string,value:any)=>state.set(key,structuredClone(value)),
  recordModelRequest:async(raw:any)=>{captures.push({kind:'request',raw:structuredClone(raw)});},
  recordModelResponse:async(raw:any)=>{captures.push({kind:'response',raw:structuredClone(raw)});}}};
}
const context=(id:string)=>({rules:{rulesText:'Synthetic rules only.'},observation:{observationId:id,legalActions:[{type:'fixture-action'}]},lastActionResult:{accepted:true}});
const reply=(id:string)=>({choices:[{message:{role:'assistant',content:null,reasoning_content:`Synthetic reasoning ${id}`,
 tool_calls:[{id,type:'function',function:{name:'act',arguments:JSON.stringify({actionJson:JSON.stringify({type:'fixture-action'})})}}]}}]});
const config={baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:'synthetic-key'};

const responsesReply=(name:string,args:any,id='call-1')=>({object:'response',status:'completed',output:[
 {type:'reasoning',content:[{type:'reasoning_text',text:'Synthetic Responses reasoning.'}]},
 {type:'function_call',call_id:id,name,arguments:JSON.stringify(args)}]});

test('Responses preflight exercises tool results and reasoning in two real request bodies without game context',async()=>{
 const requests:any[]=[];
 const agent=new MinimalAgent({...config,api:'responses'},{fetchImpl:async(url:string,init:any)=>{
  assert.equal(url,'https://api.deepseek.com/responses');const body=JSON.parse(init.body);requests.push(body);
  assert.equal(body.store,false);assert.equal(body.previous_response_id,undefined);assert.equal(body.tool_choice,undefined);
  const tool=body.tools[0];assert.equal(tool.name,'connection_check');
  if(requests.length===2){assert.equal(body.input[1].content[0].text,'Synthetic Responses reasoning.');assert.equal(body.input[3].call_id,'call-1');}
  return Response.json(responsesReply(tool.name,{nonce:tool.parameters.properties.nonce.enum[0]}));
 }});
 assert.deepEqual(await agent.testConnection(),{ok:true});assert.equal(requests.length,2);assert.ok(!JSON.stringify(requests).includes(config.apiKey));
});

test('Responses game history preserves exact output and matching tool receipts across turns',async()=>{
 const {runtime,captures}=recorder();let count=0;
 const agent=new MinimalAgent({...config,api:'responses'},{fetchImpl:async(_url:string,init:any)=>{
  const body=JSON.parse(init.body);count++;
  if(count===2){assert.equal(body.input[2].type,'reasoning');assert.equal(body.input[4].type,'function_call_output');assert.equal(body.input[4].call_id,'call-1');}
  return Response.json(responsesReply('act',{actionJson:'{"type":"fixture-action"}'},`call-${count}`));
 }});
 for(const id of ['o1','o2'])assert.deepEqual(await agent.decide(context(id),{runtime}),{action:{type:'fixture-action'}});
 assert.equal(count,2);assert.equal(captures[1].raw.output[0].content[0].text,'Synthetic Responses reasoning.');
});

test('empty output and required-turn wait are bounded; incomplete responses never submit actions',async()=>{
 for(const mode of ['empty','wait','incomplete']){
  const {runtime}=recorder();let count=0;
  const agent=new MinimalAgent({...config,api:'responses'},{fetchImpl:async()=>{count++;return Response.json(mode==='empty'?{status:'completed',output:[]}:mode==='incomplete'?{...responsesReply('act',{actionJson:'{"type":"fixture-action"}'}),status:'incomplete'}:responsesReply('wait',{}));}});
  await assert.rejects(agent.decide({...context('o1'),observation:{...context('o1').observation,control:{required:true}}},{runtime}),{code:mode==='incomplete'?'MODEL_INCOMPLETE':'MODEL_TOOL_FORMAT'});
  assert.equal(count,mode==='incomplete'?1:2);
 }
});

test('a model that never responds is cancelled by a bounded request deadline',async t=>{
 t.mock.method(AbortSignal,'timeout',()=>AbortSignal.abort(new DOMException('Synthetic deadline','TimeoutError')));
 const agent=new MinimalAgent({...config,api:'responses'},{fetchImpl:async(_url:string,{signal}:any)=>{signal.throwIfAborted();throw Error('Unreachable');}});
 await assert.rejects(agent.testConnection(),{code:'MODEL_TIMEOUT'});
});

test('thinking provider accepts consecutive decisions without forced tool choice and with full reasoning/tool history',async()=>{
 const {runtime,captures}=recorder();let requests=0;
 const agent=new MinimalAgent(config,{fetchImpl:async(_url:string,init:any)=>{
  const body=JSON.parse(init.body);requests++;
  // Reproduce the actual provider rejection, without using real credentials or game data.
  if('tool_choice' in body)return Response.json({error:{message:'Thinking mode does not support this tool_choice'}},{status:400});
  if(requests===2){
   const previous=body.messages.find((m:any)=>m.role==='assistant');
   assert.equal(previous.reasoning_content,'Synthetic reasoning call-1');assert.equal(previous.content,'');
   const receipt=body.messages.find((m:any)=>m.role==='tool');assert.equal(receipt.tool_call_id,'call-1');assert.equal(JSON.parse(receipt.content).accepted,true);
  }
  return Response.json(reply(`call-${requests}`));
 }});
 for(const id of ['o1','o2'])assert.deepEqual(await agent.decide(context(id),{runtime}),{action:{type:'fixture-action'}});
 assert.equal(requests,2);assert.equal(captures.filter(c=>c.kind==='response').length,2);
 assert.equal(captures.find(c=>c.kind==='response').raw.choices[0].message.content,null,'Capture retains the exact provider response.');
 assert.ok(!JSON.stringify(captures).includes(config.apiKey));
});

test('automatic tool selection repairs a text response with its reasoning and keeps the fixed repair budget',async()=>{
 const {runtime,captures}=recorder();let requests=0;
 const agent=new MinimalAgent(config,{fetchImpl:async(_url:string,init:any)=>{
  requests++;const body=JSON.parse(init.body);
  if(requests===2){assert.equal(body.messages.at(-2).reasoning_content,'Synthetic thought');assert.match(body.messages.at(-1).content,/exactly one/);}
  return Response.json({choices:[{message:{role:'assistant',content:'Synthetic text without a tool.',reasoning_content:'Synthetic thought'}}]});
 }});
 await assert.rejects(agent.decide(context('o1'),{runtime}),{code:'MODEL_TOOL_FORMAT'});
 assert.equal(requests,2);assert.equal(captures.length,4);
});

test('provider failures expose safe codes without treating provider HTTP 400 as a game action rejection',async()=>{
 for(const status of [400,401,429,503]){
  const {runtime,captures}=recorder();let requests=0;
  const agent=new MinimalAgent(config,{fetchImpl:async()=>{requests++;return Response.json({error:{message:'Synthetic private provider error'}},{status});}});
  await assert.rejects(agent.decide(context('o1'),{runtime}),(error:any)=>{
   assert.equal(error.code,`MODEL_API_HTTP_${status}`);assert.equal(error.status,undefined);assert.ok(!error.message.includes('private'));return true;
  });
  assert.equal(requests,status===429||status>=500?2:1);assert.equal(captures.at(-1).raw.error.message,'Synthetic private provider error');
 }
 const {runtime}=recorder(),signal=AbortSignal.abort();
 const cancelled=new MinimalAgent(config,{fetchImpl:async()=>{throw new DOMException('Synthetic cancellation','AbortError');}});
 await assert.rejects(cancelled.decide(context('o1'),{runtime,signal}),{code:'MODEL_CANCELLED'});
});
