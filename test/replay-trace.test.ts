import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto} from 'node:crypto';
const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,atob,crypto:webcrypto});
for(const file of ['replay-model.js','replay-trace.js'])vm.runInContext(readFileSync(new URL('../web/'+file,import.meta.url),'utf8'),context);
const T=context.CoopTrace;
test('trajectory reconstructs checked fragments, refuses incomplete and corrupted captures',async()=>{
 const bytes=Buffer.from(JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'中文响应'}]}]}));
 const capture={schema:'coop-agent-capture/v1',serialization:'canonical-json/v1',logicalId:'x',encoding:'base64',event:'model-output',fragment:true,count:2,totalBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const rows=[bytes.subarray(0,20),bytes.subarray(20)].map((b,i)=>({playerId:'p1',sequence:i,kind:'model-output',message:{capture:{...capture,index:i},dataBase64:b.toString('base64')}}));
 const complete=await T.decode(rows);assert.equal(complete[0].raw.output[0].content[0].text,'中文响应');
 assert.equal((await T.decode(rows.slice(0,1)))[0].incomplete,true);
 const bad=structuredClone(rows);bad[1].message.capture.sha256='0'.repeat(64);assert.ok((await T.decode(bad))[0].decodeError);
 const wrong=structuredClone(rows);for(const r of wrong)r.message.capture.sha256='0'.repeat(64);assert.match((await T.decode(wrong))[0].decodeError,/校验/);
});

test('compact cards classify five evidence types and keep settings out of extra cards',()=>{
 const blocks=T.blocks([{sequence:0,kind:'model-input',raw:{model:'fixture',tools:[],input:[{role:'system',content:'系统'},{role:'user',content:'用户'}]}},
 {sequence:1,kind:'model-output',raw:{choices:[{message:{content:'回答',reasoning_content:'推理',tool_calls:[{function:{name:'act',arguments:'{"actionJson":"{\\"type\\":\\"play\\",\\"index\\":0}","decisionSummary":"理由"}'}}]}}]}},
 {sequence:2,kind:'tool-result',raw:{accepted:false,error:{code:'INVALID_ACTION',message:'Cannot discard'}}}]);
 assert.deepEqual([...new Set(Array.from(blocks,T.category))].sort(),['call','input','output','reasoning','result']);
 assert.equal(blocks.filter(b=>b.type==='request').length,0);assert.ok(blocks.find(b=>b.settings)?.settings.tools);
 assert.match(T.preview(blocks.find(b=>b.type==='result')),/Cannot discard/);
 assert.equal(T.preview({type:'input',value:{observation:{status:'active'},rules:{}}}),'本席观察 · 规则 · 可见历史');
});

test('current tool use is linked by observation or live window, never by action text or timestamp alone',()=>{
 const action={type:'play',index:0},blocks=[
 {id:'unrelated',sequence:4,type:'call',action,submitted:true,observationId:'other'},
 {id:'model',sequence:1,type:'call',action,observationId:'selected',windowId:'window'},
 {id:'submitted',sequence:2,type:'call',action,submitted:true,observationId:'selected',windowId:'window'}];
 assert.equal(T.currentCallId(blocks,{frame:{observed:{observationId:'selected'},action}}),'submitted');
 assert.equal(T.currentCallId(blocks,{frame:{observed:{observationId:'unknown'},action}}),undefined);
 assert.equal(T.currentCallId(blocks,{live:true,observation:{observationId:'new-projection',control:{required:true,windowId:'window'}}}),'submitted');
 assert.equal(T.currentCallId(blocks,{live:true,observation:{control:{required:false,windowId:'window'}}}),undefined);
 assert.equal(T.currentCallId(blocks,{live:true,observation:{control:{required:true,windowId:'next-window'}}}),undefined);
 const decoded=T.blocks([{sequence:0,kind:'model-input',observationId:'o',raw:{messages:[{role:'user',content:JSON.stringify({observation:{observationId:'o',control:{windowId:'w'}}})}]}},{sequence:1,kind:'tool-call',observationId:'o',raw:{tool:'act',action}}]);
 assert.equal(decoded.find(b=>b.type==='call').windowId,'w');
});

test('server confirmation shares the matched receipt card without hiding unmatched or rejected evidence',()=>{
 const action={type:'play',index:0},frame={seq:1,action,observed:{observationId:'o'},decisionSummary:'理由'};
 const records=[{id:'call',type:'call',submitted:true,action,requestId:'r',observationId:'o'},{id:'result',type:'result',requestId:'r',observationId:'o',value:{accepted:true}}];
 const combined=T.withFrames(records,[frame]);assert.equal(combined.length,2);assert.equal(combined[1].confirmation.seq,1);assert.equal(records[1].confirmation,undefined);
 assert.match(T.preview(combined[1]),/第 1 步/);
 assert.equal(T.withFrames(records,[{...frame,observed:{observationId:'other'}}]).length,3);
 assert.equal(T.withFrames(records,[{...frame,error:{code:'INVALID_ACTION'}}]).length,3);
 assert.equal(T.withFrames(records.map(r=>({...r,observationId:undefined})),[{...frame,observed:undefined}]).length,3);
});
test('repeated request history does not duplicate prompt or expose quoted reasoning as actual output',()=>{
 const system={role:'system',content:'最初提示'},user={role:'user',content:JSON.stringify({observation:{view:{hand:'unknown'}}})};
 const records=[{sequence:0,kind:'model-input',raw:{input:[system,user],tools:[]}},
 {sequence:1,kind:'model-output',raw:{output:[{type:'reasoning',summary:[{type:'summary_text',text:'真实返回的摘要'}]},{type:'function_call',name:'act',arguments:JSON.stringify({actionJson:'{"type":"play","index":0}',decisionSummary:'中文行动理由'})}]}},
 {sequence:2,kind:'tool-call',raw:{tool:'act',action:{type:'play',index:0},decisionSummary:'中文行动理由'}},
 {sequence:3,kind:'tool-result',raw:{accepted:true}},
 {sequence:4,kind:'model-input',raw:{input:[system,user,{role:'assistant',reasoning:'quoted fake',content:'history'},{role:'user',content:'下一步'}],tools:[]}}];
 const blocks=T.blocks(records);assert.equal(blocks.filter(b=>b.type==='prompt').length,1);
 assert.deepEqual(Array.from(blocks.filter(b=>b.type==='reasoning').map(b=>b.value)),['真实返回的摘要']);
 assert.equal(blocks.find(b=>b.title==='提交动作').reason,'中文行动理由');assert.equal(blocks[0].sequence,4);
 assert.equal(blocks.find(b=>b.title==='调用工具 · act').action.index,0);assert.equal(blocks.find(b=>b.type==='result').value.accepted,true);
});
