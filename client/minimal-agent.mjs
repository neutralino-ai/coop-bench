import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const failure=(code,message=code)=>Object.assign(new Error(message),{code});
const transient=code=>code==='MODEL_NETWORK_ERROR'||code==='MODEL_TIMEOUT'||/^MODEL_API_HTTP_(429|5\d\d)$/.test(code);
async function providerBody(response) {
  const reader=response.body?.getReader();if(!reader)throw Error('EMPTY_RESPONSE');
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16*1024*1024)throw Error('RESPONSE_TOO_LARGE');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks).toString('utf8');
}

/** Deliberately no game policy. The provider receives only the legal seat context. */
export class MinimalAgent {
  #key;#url;#model;#fetch;#api;
  constructor({baseUrl,apiKey,model,api='chat-completions'},{fetchImpl=fetch}={}) {
    const u=new URL(baseUrl);if(!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))||u.username||u.password||u.search||u.hash)throw Error('Model endpoint must be HTTPS (or loopback HTTP).');
    if(typeof apiKey!=='string'||!apiKey||typeof model!=='string'||!model||model.length>200)throw Error('Model, API key and base URL are required.');
    if(!['responses','chat-completions'].includes(api))throw Error('Unsupported model API.');
    this.#api=api;this.#key=apiKey;this.#url=u.href.replace(/\/$/,'')+(api==='responses'?'/responses':'/chat/completions');this.#model=model;this.#fetch=fetchImpl;
  }
  #request(messages,tools){
    // Automatic tool selection works in thinking mode on both protocols.
    return this.#api==='responses'?{model:this.#model,input:messages,tools:tools.map(t=>({type:'function',...t.function})),store:false}:
      {model:this.#model,messages,tools,parallel_tool_calls:false};
  }
  #items(raw){return this.#api==='responses'?(Array.isArray(raw.output)?raw.output:[]):raw.choices?.[0]?.message?[{...raw.choices[0].message,content:raw.choices[0].message.content??''}]:[];}
  #calls(raw){const chatCalls=raw.choices?.[0]?.message?.tool_calls;return this.#api==='responses'?this.#items(raw).filter(i=>i?.type==='function_call').map(i=>({id:i.call_id,name:i.name,arguments:i.arguments})):
    (Array.isArray(chatCalls)?chatCalls:[]).map(c=>({id:c?.id,name:c?.function?.name,arguments:c?.function?.arguments}));}
  #receipt(call,output){return this.#api==='responses'?{type:'function_call_output',call_id:call.id,output}:{role:'tool',tool_call_id:call.id,content:output};}
  async #complete(request,{signal,runtime,observationId}={}){
    const details={...(observationId?{observationId}:{}),model:this.#model,provider:new URL(this.#url).origin};
    for(let retry=0;retry<2;retry++){
      await runtime?.recordModelRequest(request,details);
      const attemptSignal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(60000)]);
      try{
        let response,body;
        try{
          response=await this.#fetch(this.#url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${this.#key}`,'Content-Type':'application/json'},body:JSON.stringify(request),signal:attemptSignal});body=await providerBody(response);
        }catch(error){
          const code=attemptSignal.aborted?(attemptSignal.reason?.name==='TimeoutError'?'MODEL_TIMEOUT':'MODEL_CANCELLED'):error.message==='RESPONSE_TOO_LARGE'?'MODEL_RESPONSE_TOO_LARGE':'MODEL_NETWORK_ERROR';
          await runtime?.recordTransportResult?.({source:'model-api',outcome:'response-unavailable',code},details);
          throw failure(code,error.message);
        }
      let raw;
      try{raw=JSON.parse(body);}catch{
        await runtime?.recordModelResponse({format:'non-json-http-body',httpStatus:response.status,bodyText:body},{...details,reasoningAvailability:'not-provided'});
        throw failure(response.ok?'MODEL_INVALID_RESPONSE':`MODEL_API_HTTP_${response.status}`,`Model API returned non-JSON (HTTP ${response.status}).`);
      }
      const message=raw?.choices?.[0]?.message,output=Array.isArray(raw?.output)?raw.output:[];
      const plainReasoning=[message?.reasoning_content,message?.reasoning].some(v=>typeof v==='string'&&v.trim())||output.some(i=>i?.type==='reasoning'&&Array.isArray(i.content)&&i.content.some(c=>c?.type==='reasoning_text'&&c.text));
      await runtime?.recordModelResponse(raw,{...details,reasoningAvailability:plainReasoning?'provided':typeof message?.reasoning_summary==='string'||output.some(i=>i?.type==='reasoning'&&i.summary?.length)?'summary-only':'not-provided'});
      // `status` on exceptions is reserved for game API failures in the runtime.
      if(!response.ok)throw failure(`MODEL_API_HTTP_${response.status}`,`Model API HTTP ${response.status}`);
      if(!raw||typeof raw!=='object'||Array.isArray(raw))throw failure('MODEL_INVALID_RESPONSE');
      if(this.#api==='responses'&&raw.status!=='completed')throw failure('MODEL_INCOMPLETE');
      return raw;
      }catch(error){if(retry||signal?.aborted||!transient(error.code))throw error;await delay(500,undefined,{signal}).catch(()=>{throw failure('MODEL_CANCELLED');});}
    }
  }
  async testConnection({signal}={}){
    signal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(60000)]);
    const nonce=randomUUID(),tools=[{type:'function',function:{name:'connection_check',description:'Return the supplied nonce to verify tool calling.',parameters:{type:'object',properties:{nonce:{type:'string',enum:[nonce]}},required:['nonce'],additionalProperties:false}}}];
    const messages=[{role:'user',content:`Connectivity test only, no game. Call connection_check exactly once with nonce ${nonce}.`}];
    for(let turn=0;turn<2;turn++){
      const raw=await this.#complete({...this.#request(messages,tools),...(this.#api==='responses'?{max_output_tokens:4096}:{max_tokens:4096})},{signal});
      const calls=this.#calls(raw);let valid=false;
      try{valid=calls.length===1&&calls[0].id&&calls[0].name==='connection_check'&&JSON.parse(calls[0].arguments).nonce===nonce;}catch{}
      if(!valid)throw failure('MODEL_TOOL_FORMAT');
      messages.push(...this.#items(raw),this.#receipt(calls[0],JSON.stringify({ok:true})),{role:'user',content:`Tool receipt received. Verify one more call with the same nonce ${nonce}.`});
    }
    return {ok:true};
  }
  async decide(context,{signal,runtime}) {
    signal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(120000)]);
    const historyKey=this.#api==='responses'?'responsesHistory':'modelHistory',pendingKey=this.#api==='responses'?'responsesPendingTools':'modelPendingTools';
    const messages=runtime.get(historyKey)??[{role:'system',content:'You are one player in a cooperative board game. Use only the supplied API rules and your seat observations. Every unseen visible event is included in observation.updates. Every act must include decisionSummary: a brief Chinese explanation (1–1200 characters) of this action based on visible information. This is a concise decision reason, not a request for private chain-of-thought. Call exactly one act with a JSON action from legalActions, or wait only when strategic waiting is legal. No side-channel communication. New rooms default to a 3-minute required-action window; honor the actual observation.control.decisionTimeoutSeconds and deadlineAt. Waiting does not extend the deadline. With timeoutPolicy=default-action-v1 or default-action-v2 the server performs the deterministic legal control.timeoutAction on timeout and continues. Legacy sessions retain their policy. After timeout refresh your observation, never replay stale actions. The episode limit and official game clocks still apply.'}];
    const pending=runtime.get(pendingKey);
    if(pending){for(const p of pending){const call=p.function?{id:p.id,name:p.function.name}:p;messages.push(this.#receipt(call,JSON.stringify(call.name==='wait'?{waiting:true}:context.lastActionResult??{accepted:false,error:{code:'NO_RECEIPT'}})));}runtime.put(pendingKey,null);}
    messages.push({role:'user',content:JSON.stringify(context)});runtime.put(historyKey,messages);
    const tools=[{type:'function',function:{name:'act',description:'Submit exactly one rule action. actionJson is the full JSON action matching a supplied legalActions schema.',parameters:{type:'object',properties:{actionJson:{type:'string'},decisionSummary:{type:'string',minLength:1,maxLength:1200,description:'Required concise reason in Chinese, based only on this seat visible information.'}},required:['actionJson','decisionSummary'],additionalProperties:false}}},
      {type:'function',function:{name:'wait',description:'Wait for a new visible event only when strategic waiting is legal.',parameters:{type:'object',properties:{},additionalProperties:false}}}];
    for(let attempt=0;attempt<2;attempt++){
      const raw=await this.#complete(this.#request(messages,tools),{signal,runtime,observationId:context.observation.observationId}),calls=this.#calls(raw);
      messages.push(...this.#items(raw));
      let answer=null;
      try{if(calls.length!==1||!calls[0].id)throw Error('Call exactly one tool.');
        const call=calls[0];if(call.name==='wait'&&!context.observation.control?.required)answer={wait:true};
        else if(call.name==='act'){const arg=JSON.parse(call.arguments),action=JSON.parse(arg.actionJson);if(!action||typeof action.type!=='string')throw Error('Invalid action.');const reason=arg.decisionSummary;if(typeof reason!=='string'||!reason.trim()||reason.length>1200||!/[\u3400-\u9fff]/u.test(reason))throw Error('Include decisionSummary in Chinese.');answer={action,decisionSummary:reason.trim()};}
      }catch{}
      if(answer){runtime.put(pendingKey,calls);runtime.put(historyKey,messages);return answer;}
      for(const call of calls)if(call.id)messages.push(this.#receipt(call,'Invalid tool format; call exactly one tool. A required turn needs act, not wait. Every act needs a nonempty decisionSummary in Chinese (at most 1200 characters).'));
      messages.push({role:'user',content:'Use exactly one valid act or wait tool. If observation.control.required is true, you must act. Include decisionSummary with a concise Chinese reason (1–1200 characters).' });runtime.put(historyKey,messages);
    }
    throw failure('MODEL_TOOL_FORMAT','Model did not return a valid tool call within the fixed repair budget.');
  }
}
