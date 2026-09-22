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
