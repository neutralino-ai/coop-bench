/* Read-only presentation of recorded evidence. Never imported by a seat runtime. */
globalThis.CoopTrace=(()=>{
 const canonical=v=>JSON.stringify(sort(v));
 function sort(v){if(Array.isArray(v))return v.map(sort);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])]));return v;}
 const parsed=v=>{if(typeof v!=='string')return v;try{return JSON.parse(v);}catch{return v;}};
 const text=v=>typeof v==='string'?v:Array.isArray(v)?v.map(text).filter(Boolean).join('\n'):v?.text??v?.thinking??'';
 async function decode(records){
  const groups=new Map(),result=[];
  for(const r of records){const c=r.message?.capture;if(!c){result.push({...r,raw:r.message?.raw??r.message});continue;}const key=[r.playerId,r.kind,c.logicalId].join(':');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  for(const group of groups.values()){
   group.sort((a,b)=>a.sequence-b.sequence);const first=group[0],c=first.message.capture;
   try{
    if(c.schema!=='coop-agent-capture/v1'||c.serialization!=='canonical-json/v1'||!Number.isSafeInteger(c.totalBytes)||c.totalBytes<1||c.totalBytes>64*1024*1024)throw Error('记录格式无效');
    let bytes,raw;
    if(c.fragment){
     if(!Number.isSafeInteger(c.count)||c.count<1||group.length!==c.count){result.push({...first,incomplete:true});continue;}
     const chunks=new Map();for(const r of group){const m=r.message,d=m.capture;
      if(['schema','serialization','logicalId','event','encoding','fragment','count','totalBytes','sha256'].some(k=>d[k]!==c[k])||!Number.isSafeInteger(d.index)||d.index<0||d.index>=c.count||chunks.has(d.index)||d.encoding!=='base64')throw Error('分片不一致');
      const b=Uint8Array.from(atob(m.dataBase64),v=>v.charCodeAt(0));chunks.set(d.index,b);
     }
     bytes=new Uint8Array(c.totalBytes);let offset=0;for(let i=0;i<c.count;i++){const b=chunks.get(i);bytes.set(b,offset);offset+=b.length;}if(offset!==c.totalBytes)throw Error('分片长度不一致');
     raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    }else{if(c.encoding!=='json'||group.length!==1)throw Error('记录格式无效');raw=first.message.raw;bytes=new TextEncoder().encode(canonical(raw));}
    if(bytes.length!==c.totalBytes)throw Error('记录长度不一致');
    const digest=await crypto.subtle.digest('SHA-256',bytes),hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
    if(hash!==c.sha256)throw Error('记录校验失败');
    result.push({...first,raw});
   }catch(error){result.push({...first,decodeError:error.message});}
  }
  return result.sort((a,b)=>a.sequence-b.sequence);
 }
 function blocks(records){
  const out=[],windows=new Map();let previous=[],lastInstructions;
  const add=(r,type,title,value,extra={})=>out.push({id:`${r.sequence}:${out.length}`,sequence:r.sequence,at:r.clientAt??r.createdAt??r.serverReceivedAt,observationId:r.observationId,requestId:r.requestId,windowId:windows.get(r.observationId),type,title,value,...extra});
  function call(r,name,args,submitted=false){const data=parsed(args)??{},action=parsed(data.actionJson)??data.action;
   add(r,'call',submitted?'提交动作':`调用工具 · ${name??'未命名'}`,action??data,{reason:data.decisionSummary,submitted,tool:name,action:action&&typeof action==='object'?action:undefined});
  }
  for(const r of records){
   if(r.incomplete){add(r,'notice','轨迹分片尚未收齐','继续读取后会自动组合。');continue;}
   if(r.decodeError){add(r,'notice','此条轨迹无法展示',r.decodeError);continue;}
   const raw=r.raw;if(!raw)continue;
   if(r.kind==='model-input'){
    if(raw.instructions&&raw.instructions!==lastInstructions){add(r,'prompt','系统提示',raw.instructions);lastInstructions=raw.instructions;}
    const messages=raw.input??raw.messages??(raw.role?[raw]:[]);
    for(const m of typeof messages==='string'?[{content:messages}]:Array.isArray(messages)?messages:[]){const input=parsed(text(m.content)),obs=input?.observation;if(obs?.observationId&&obs.control?.windowId)windows.set(obs.observationId,obs.control.windowId);}
    if(typeof messages==='string')add(r,'input','提供给模型的信息',parsed(messages));
    else if(Array.isArray(messages)){
     let common=0;while(common<messages.length&&common<previous.length&&canonical(messages[common])===canonical(previous[common]))common++;
     for(const m of messages.slice(common)){
      if(['system','developer'].includes(m.role))add(r,'prompt','初始提示 / 系统指令',text(m.content));
      else if(m.role==='user')add(r,'input','用户消息',parsed(text(m.content)));
      else if(m.role==='tool'||m.type==='function_call_output')add(r,'result','送入模型的工具回执',parsed(m.output??text(m.content)));
      // Assistant and tool history is already represented by its original captures.
     }previous=messages;
    }else add(r,'input','提供给模型的信息',raw);
    const settings={...raw};delete settings.input;delete settings.messages;delete settings.instructions;
    if(Object.keys(settings).length){const input=out.findLast(b=>b.sequence===r.sequence&&['input','prompt'].includes(b.type));if(input)input.settings=settings;else add(r,'request','模型请求设置与工具',settings);}
   }else if(r.kind==='model-output'){
    const thoughts=globalThis.CoopReplay.reasoning([{...r,message:{role:'assistant',raw}}]);
    for(const t of thoughts)add(r,'reasoning',t.label,t.text);
    const messages=[raw,...(raw.choices??[]).map(c=>c.message),...(raw.output??[])];let shown=thoughts.length>0;
    for(const m of messages){if(!m)continue;
     if(m.type==='function_call'){call(r,m.name,m.arguments);shown=true;}
     for(const c of m.tool_calls??[]){call(r,c.function?.name,c.function?.arguments);shown=true;}
     if(m.type!=='reasoning'){const content=typeof m.content==='string'?m.content:text((m.content??[]).filter?.(b=>['text','output_text'].includes(b.type))??[]);if(content){add(r,'output','模型回复',content);shown=true;}}
    }
    if(!shown)add(r,'output','模型返回',raw.error??raw.status??'没有返回可读文字或工具调用。');
   }else if(r.kind==='tool-call')call(r,raw.tool??raw.name,raw,raw.tool==='act');
   else if(r.kind==='tool-result')add(r,'result',`工具结果${raw.tool?' · '+raw.tool:''}`,raw);
   else add(r,'notice',r.kind??'记录',raw);
  }
  return out.reverse();
 }
 function category(block){return ({prompt:'input',input:'input',request:'input',output:'output',reasoning:'reasoning',call:'call',result:'result',action:'result'})[block.type]??'notice';}
 function preview(block){
  if(block.confirmation)return `已确认 · 第 ${block.confirmation.seq} 步 · `+globalThis.CoopReplay.actionText(block.confirmation);
  if(block.action)return (category(block)==='result'?(block.value?.accepted===false?'拒绝 · ':'已确认 · '):'')+globalThis.CoopReplay.actionText({action:block.action})+(block.reason?' · '+block.reason:'');
  if(typeof block.value==='string')return block.value;
  const v=block.value??{};
  if(category(block)==='result'){
   if(v.error)return '未接受 · '+(v.error.message??v.error.code??String(v.error));
   if(v.accepted===true||v.observation)return '服务器已确认'+(v.observation?.status?' · '+v.observation.status:'');
   if(v.accepted===false)return '未接受';
   if(v.accepted===null)return '结果待确认';
  }
  if(v.protocol||v.rules||v.observation)return '本席观察 · 规则 · 可见历史';
  return Object.keys(v).slice(0,5).map(k=>({model:'模型',tools:'可用工具',observation:'本席观察',rules:'规则',updates:'可见历史',lastActionResult:'上次回执'})[k]??k).join(' · ')||block.title;
 }
 function currentCallId(blocks,{frame,live,observation}){
  const candidates=blocks.filter(b=>b.type==='call'&&b.action&&(live
   ?observation?.control?.required===true&&((b.windowId&&b.windowId===observation.control.windowId)||(b.observationId&&b.observationId===observation.observationId))
   :frame?.observed?.observationId&&b.observationId===frame.observed.observationId&&canonical(b.action)===canonical(frame.action)));
  return (candidates.filter(b=>b.submitted).sort((a,b)=>b.sequence-a.sequence)[0]??candidates.sort((a,b)=>b.sequence-a.sequence)[0])?.id;
 }
 function withFrames(recorded,frames){
  const result=recorded.map(b=>({...b}));
  for(const f of frames){
   const receipt=!f.error&&f.observed?.observationId&&result.find(b=>b.type==='result'&&b.requestId&&b.observationId===f.observed.observationId&&(b.value?.accepted===true||b.value?.observation)&&recorded.some(c=>c.type==='call'&&c.submitted&&c.requestId===b.requestId&&c.observationId===b.observationId&&canonical(c.action)===canonical(f.action)));
   if(receipt)receipt.confirmation={seq:f.seq,action:f.action,decisionSummary:f.decisionSummary};
   else result.push({id:'frame-'+f.seq,sequence:Infinity,at:f.at,type:'result',title:`服务器${f.error?'拒绝':'已确认'} · 第 ${f.seq} 步`,value:{action:f.action,accepted:!f.error,...(f.error?{error:f.error}:{}),...(f.automatic?{automatic:f.automatic}:{})},action:f.action,reason:f.decisionSummary??(f.automatic?'服务器超时默认动作':null)});
  }
  return result;
 }
 return Object.freeze({decode,blocks,parsed,category,preview,currentCallId,withFrames});
})();
