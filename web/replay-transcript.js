/* Uploaded transcripts are untrusted evidence. Read known structures only; never execute content. */
globalThis.CoopTranscript=(()=>{
 function records(source){
  let rows;
  try{const value=JSON.parse(source);rows=Array.isArray(value)?value:value.messages??value.records??[value];}
  catch{rows=source.split(/\r?\n/).filter(line=>line.trim()).map((line,i)=>{try{return JSON.parse(line);}catch{throw Error(`第 ${i+1} 行不是有效 JSON`);}});}
  if(!Array.isArray(rows)||rows.length>100000)throw Error('轨迹记录数量无效或超过 100000 条');
  const result=[],structured=rows.some(r=>r.type==='response_item');
  function add(kind,raw,row){result.push({sequence:result.length,kind,raw,clientAt:row.timestamp??row.at??row.clientAt??row.createdAt,observationId:row.observationId,requestId:row.requestId});}
  function message(m,row){
   if(!m||typeof m!=='object')return;
   if(['system','developer'].includes(m.role)){add('model-input',{instructions:m.content},row);return;}
   if(m.type==='reasoning'){add('model-output',{output:[m]},row);return;}
   if(['function_call','custom_tool_call','tool_use'].includes(m.type)){add('tool-call',{name:m.name,arguments:m.arguments??m.input},row);return;}
   if(['function_call_output','custom_tool_call_output','tool_result'].includes(m.type)||m.role==='tool'){add('tool-result',m.output??m.content??m,row);return;}
   if(m.role==='user'){
    const content=Array.isArray(m.content)?m.content:[{type:'text',text:m.content}];
    for(const block of content){if(block.type==='tool_result')add('tool-result',block.content??block,row);else if(['text','input_text'].includes(block.type)&&block.text)add('model-input',{role:'user',content:block.text},row);}
   }else if(m.role==='assistant'){
    if(m.channel==='analysis')add('model-output',{reasoning:m.content},row);
    else add('model-output',m,row);
   }
  }
  for(const row of rows){
   if(!row||typeof row!=='object')continue;
   if(['model-input','model-output','tool-call','tool-result'].includes(row.kind)){
    if(row.message?.capture)result.push({...row,sequence:row.sequence??result.length});
    else add(row.kind,row.raw??row.message?.raw??row.message??row,row);
   }else if(row.type==='response_item')message(row.payload,row);
   else if(row.type==='session_meta'&&row.payload?.base_instructions){const value=row.payload.base_instructions;add('model-input',{instructions:typeof value==='string'?value:value.text},row);}
   else if(row.type==='event_msg'){
    // Codex may save both event notifications and canonical response items.
    if(!structured&&['user_message','agent_message','agent_reasoning'].includes(row.payload?.type))message({role:row.payload.type==='user_message'?'user':'assistant',channel:row.payload.type==='agent_reasoning'?'analysis':undefined,content:row.payload.message??row.payload.text},row);
   }else if(row.message?.role)message(row.message,row); // Claude-style JSONL
   else if(['system','user','assistant','assis','assis-reasoning','tool_use','tool_result'].includes(row.type))message({...row,role:row.role??({assis:'assistant','assis-reasoning':'assistant'})[row.type]??row.type,channel:row.type==='assis-reasoning'?'analysis':row.channel},row);
   else message(row,row);
  }
  return result;
 }
 async function blocks(source,artifact){
  const rows=records(source),decoded=await globalThis.CoopTrace.decode(rows.map(r=>r.raw===undefined?r:{...r,message:{raw:r.raw}}));
  return globalThis.CoopTrace.blocks(decoded).map(b=>({...b,id:`artifact-${artifact.id}-${b.id}`,at:b.at??artifact.completedAt??artifact.createdAt,sourceName:artifact.name}));
 }
 return Object.freeze({records,blocks});
})();
