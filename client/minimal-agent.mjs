async function providerBody(response) {
  const reader=response.body?.getReader();if(!reader)throw Error('EMPTY_RESPONSE');
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16*1024*1024)throw Error('RESPONSE_TOO_LARGE');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks).toString('utf8');
}

/** Deliberately no game policy. The provider receives only the legal seat context. */
export class MinimalAgent {
  #key;#url;#model;#fetch;
  constructor({baseUrl,apiKey,model},{fetchImpl=fetch}={}) {
    const u=new URL(baseUrl);if(!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))||u.username||u.password||u.search||u.hash)throw Error('Model endpoint must be HTTPS (or loopback HTTP).');
    if(typeof apiKey!=='string'||!apiKey||typeof model!=='string'||!model||model.length>200)throw Error('Model, API key and base URL are required.');
    this.#key=apiKey;this.#url=u.href.replace(/\/$/,'')+'/chat/completions';this.#model=model;this.#fetch=fetchImpl;
  }
  async decide(context,{signal,runtime}) {
    const messages=runtime.get('modelHistory')??[{role:'system',content:'You are one player in a cooperative board game. Obey the supplied rules and information restrictions. Only use your seat observations. Every unseen visible event is included in observation.updates. Choose your own action, never infer access to hidden state. Call act with a JSON action from legalActions, or wait when strategic waiting is legal. No side-channel communication. Operational deadline is 60 seconds; waiting does not extend it.'}];
    const pending=runtime.get('modelPendingTools');
    if(pending){for(const call of pending)messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(call.function.name==='wait'?{waiting:true}:context.lastActionResult??{accepted:false,error:{code:'NO_RECEIPT',message:'No accepted action receipt is available.'}})});runtime.put('modelPendingTools',null);}
    messages.push({role:'user',content:JSON.stringify(context)});
    // Persist the actual outbound history before network I/O; failed requests
    // remain available for the next decision and local crash recovery.
    runtime.put('modelHistory',messages);
    const tools=[{type:'function',function:{name:'act',description:'Submit exactly one rule action. actionJson encodes the full action object matching a supplied legalActions schema.',parameters:{type:'object',properties:{actionJson:{type:'string'}},required:['actionJson'],additionalProperties:false}}},
      {type:'function',function:{name:'wait',description:'Choose to wait for a new visible event; this does not extend a required deadline.',parameters:{type:'object',properties:{},additionalProperties:false}}}];
    for(let attempt=0;attempt<2;attempt++){
      const request={model:this.#model,messages,tools,tool_choice:'required',parallel_tool_calls:false};
      const details={observationId:context.observation.observationId,model:this.#model,provider:new URL(this.#url).origin};
      await runtime.recordModelRequest(request,details);
      let response,body;
      try {
        response=await this.#fetch(this.#url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${this.#key}`,'Content-Type':'application/json'},body:JSON.stringify(request),signal});
        body=await providerBody(response);
      }catch(error){
        await runtime.recordTransportResult?.({source:'model-api',outcome:'response-unavailable',code:signal?.aborted?'CANCELLED':error.message==='RESPONSE_TOO_LARGE'?'RESPONSE_TOO_LARGE':'NETWORK_ERROR'},details);
        throw error;
      }
      let raw;
      try{raw=JSON.parse(body);}catch{
        await runtime.recordModelResponse({format:'non-json-http-body',httpStatus:response.status,bodyText:body},{...details,reasoningAvailability:'not-provided'});
        throw Error(`Model API returned non-JSON (HTTP ${response.status}).`);
      }
      const message=raw.choices?.[0]?.message;
      const plainReasoning=[message?.reasoning_content,message?.reasoning].some(v=>typeof v==='string'&&v.trim());
      await runtime.recordModelResponse(raw,{...details,reasoningAvailability:plainReasoning?'provided':typeof message?.reasoning_summary==='string'?'summary-only':'not-provided'});
      if(!response.ok)throw Error(`Model API HTTP ${response.status}`);
      const calls=message?.tool_calls;
      if(message)messages.push(message);
      let answer=null;
      try{if(!Array.isArray(calls)||calls.length!==1)throw Error('Call exactly one tool.');
        const call=calls[0];if(call.function.name==='wait')answer={wait:true};
        else if(call.function.name==='act'){const arg=JSON.parse(call.function.arguments),action=JSON.parse(arg.actionJson);if(!action||typeof action.type!=='string')throw Error('Invalid action.');answer={action};}
      }catch{}
      if(answer){runtime.put('modelPendingTools',calls);runtime.put('modelHistory',messages);return answer;}
      if(Array.isArray(calls))for(const call of calls)messages.push({role:'tool',tool_call_id:call.id,content:'Invalid tool format; use exactly one act or wait tool.'});
      else messages.push({role:'user',content:'Use exactly one act or wait tool.'});
      runtime.put('modelHistory',messages);
    }
    throw Error('Model did not return a valid tool call within the fixed repair budget.');
  }
}
