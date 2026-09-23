import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,atob,crypto:webcrypto});
for(const file of ['replay-model.js','replay-trace.js','replay-transcript.js'])vm.runInContext(readFileSync(new URL('../web/'+file,import.meta.url),'utf8'),context);
const T=context.CoopTranscript,trace=context.CoopTrace,artifact={id:'fixture',name:'fixture.jsonl',completedAt:123};
test('Codex response items become six categories without duplicating event notifications',async()=>{
 const source=[{type:'event_msg',payload:{type:'agent_reasoning',text:'duplicate'}},
 ...[{role:'system',content:'system'},{role:'user',content:[{type:'input_text',text:'user quoted reasoning: fake'}]},
 {role:'assistant',channel:'analysis',content:[{type:'text',text:'actual recorded analysis'}]},
 {role:'assistant',content:[{type:'output_text',text:'<img src=x>'}]},
 {type:'function_call',name:'act',arguments:'{"actionJson":"{\\"type\\":\\"play\\",\\"index\\":0}","decisionSummary":"真实理由"}'},
 {type:'function_call_output',output:'{"accepted":true}'}].map(payload=>({type:'response_item',payload}))].map(r=>JSON.stringify(r)).join('\n');
 const blocks=await T.blocks(source,artifact);
 assert.deepEqual([...new Set(Array.from(blocks,trace.category))].sort(),['call','input','output','reasoning','result','system']);
 assert.deepEqual(Array.from(blocks.filter(b=>b.type==='reasoning'),b=>b.value),['actual recorded analysis']);
 assert.equal(blocks.find(b=>b.type==='output').value,'<img src=x>');
 assert.equal(blocks.find(b=>b.type==='call').action.index,0);
 assert.ok(blocks.every(b=>b.id.startsWith('artifact-fixture-')&&b.at===123));
});
test('Claude tool and thinking blocks preserve real categories and skip redacted thinking',async()=>{
 const source=[{type:'assistant',message:{role:'assistant',content:[{type:'thinking',thinking:'recorded thinking'},{type:'redacted_thinking',data:'opaque'},{type:'tool_use',name:'shell',input:{command:'test'}},{type:'text',text:'answer'}]}},
 {type:'user',message:{role:'user',content:[{type:'tool_result',tool_use_id:'call',content:'result'},{type:'text',text:'next user'}]}}];
 const blocks=await T.blocks(JSON.stringify(source),artifact);
 assert.equal(blocks.filter(b=>b.type==='reasoning').length,1);
 assert.equal(blocks.find(b=>b.type==='call').tool,'shell');
 assert.equal(blocks.find(b=>b.type==='result').value,'result');
 assert.equal(blocks.find(b=>b.type==='input').value,'next user');
});
test('tool-only external evidence replaces reasons; malformed or unrelated files do not',async()=>{
 const blocks=await T.blocks(JSON.stringify([{kind:'tool-call',message:{raw:{tool:'wait'}}},{kind:'tool-result',message:{raw:{status:'completed'}}}]),artifact);
 assert.equal(trace.hasTrace(blocks),true);
 assert.equal(trace.hasTrace(await T.blocks('{"fixture":true}',artifact)),false);
 await assert.rejects(T.blocks('not JSON',artifact),/JSON/);
 assert.equal(trace.hasTrace([{type:'notice',value:'incomplete'}]),false);
});
