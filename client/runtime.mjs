import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { AgentMessageRecorder } from '../scripts/agent-message-recorder.mjs';
import { apiUrl, invitation, jsonResponse, modelObservation, observationPage } from './protocol.mjs';

/** One instance owns ONE seat. Strategies never receive this object's token. */
export class PlayerRuntime extends EventEmitter {
  #config;#db;#fetch;#stop=new AbortController();#recorder;#running;#modelBusy=false;#actionBusy=false;#recorderTasks=[];#retry;#decisionTask;#closing;#clockOffset=0;#transport='long-poll';
  room=null;observation=null;rules=null;status='disconnected';
  constructor(config,{fetchImpl=fetch}={}) {
    super();this.#config={...config,apiUrl:apiUrl(config.apiUrl),playerToken:config.playerToken??config.seatToken??randomBytes(32).toString('base64url')};this.#fetch=fetchImpl;
    if(config.transport&&!['auto','sse','long-poll'].includes(config.transport))throw Error('Unknown observation transport.');
    if(config.transport==='sse')this.#transport='sse';
    if(!/^[a-f0-9-]{36}$/.test(config.roomId??''))throw Error('Invalid room ID.');
    mkdirSync(config.directory,{recursive:true,mode:0o700});const file=join(config.directory,'session.sqlite');
    this.#db=new DatabaseSync(file);chmodSync(file,0o600);
    this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS local_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);');
    const binding=createHash('sha256').update(JSON.stringify([this.#config.apiUrl,config.roomId,this.#config.playerToken])).digest('hex');
    const stored=this.get('binding');if(stored&&stored!==binding){this.#db.close();throw Error('This directory belongs to a different seat.');}this.put('binding',binding);
    this.observation=this.get('observation');
  }
  static fromInvitation(text,config,deps) {return new PlayerRuntime({...invitation(text),...config},deps);}
  /** Host persists this privately; never expose it through the model or renderer. */
  credentials() {return {apiUrl:this.#config.apiUrl,roomId:this.#config.roomId,playerToken:this.#config.playerToken,name:this.#config.name};}
  get(key) {const v=this.#db.prepare('SELECT value FROM local_state WHERE key=?').get(key);return v?JSON.parse(v.value):null;}
  put(key,value) {this.#db.prepare('INSERT INTO local_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
  #state(status) {this.status=status;this.emit('state',this.snapshot());}
  snapshot() {return {status:this.status,room:this.room,observation:this.observation?modelObservation(this.observation):null,rules:this.rules,trace:this.#recorder?.status()??null,clockOffsetMs:this.#clockOffset};}
  async #request(path,body,token=this.#config.playerToken,key,timeoutMs=15000) {
    const response=await this.#fetch(this.#config.apiUrl+path,{method:body===undefined?'GET':'POST',redirect:'error',
      headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'}),...(key?{'Idempotency-Key':key}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.any([this.#stop.signal,AbortSignal.timeout(timeoutMs)])});
    const data=await jsonResponse(response);
    if(!response.ok)throw Object.assign(Error(data.error?.message??`HTTP ${response.status}`),{code:data.error?.code,status:response.status,data});return data;
  }
  async connect() {
    this.#state('connecting');
    if(this.#config.inviteToken)this.room=await this.#request(`/rooms/${this.#config.roomId}/join`,{name:this.#config.name??'Player',playerToken:this.#config.playerToken},this.#config.inviteToken);
    else {
      try{this.room=await this.#request(`/rooms/${this.#config.roomId}`);}
      catch(error){if(error.status!==401)throw error;this.room=await this.#request(`/rooms/${this.#config.roomId}/join`,{name:this.#config.name??'Player',playerToken:this.#config.playerToken});}
    }
    this.rules=await this.#request(`/games/${this.room.gameId}`);
    this.#state('waiting');return this.snapshot();
  }
  async roomCommand(command,input={}) {
    if(!['ready','start','kick','leave','invite'].includes(command))throw Error('Unknown room command.');
    const data=await this.#request(`/rooms/${this.#config.roomId}/${command}`,input);
    if(command!=='invite'){this.room=data;this.#state('waiting');}return data;
  }
  async ready(ready=true) {return this.roomCommand('ready',{ready,rosterVersion:this.room.rosterVersion});}
  async #capture(method,raw,details={}) {
    if(!this.#recorder)throw Error('No episode recorder.');
    // The recorder enqueues/fsyncs synchronously; uploading is independent of play.
    const job=this.#recorder[method](raw,details).catch(()=>{this.emit('trace-warning','Trace upload pending; durable local outbox retained.');});
    this.#recorderTasks.push(job);if(this.#recorderTasks.length>32)this.#recorderTasks.splice(0,16);return undefined;
  }
  async recordModelRequest(raw,details) {await this.#capture('recordModelRequest',raw,details);this.#ackContext(details?.observationId);}
  recordModelResponse(raw,details) {
    if(['provided','summary-only','redacted'].includes(details?.reasoningAvailability))this.put('reasoningAvailability',details.reasoningAvailability);
    return this.#capture('recordModelResponse',raw,details);
  }
  recordTransportResult(raw,details) {return this.#capture('recordToolResult',raw,details);}
  #ackContext(observationId) {
    const offered=this.get('offeredContext');if(!offered||offered.observationId!==observationId)return;
    this.put('pendingUpdates',(this.get('pendingUpdates')??[]).filter(update=>update.seq>offered.through));
  }
  #accept(observation) {
    if((observation.updateCursor??0)<(this.observation?.updateCursor??0))return;
    const page=observationPage(observation,this.get('deliveredCursor')??0);observation=page.observation;
    const pending=new Map((this.get('pendingUpdates')??[]).map(u=>[u.seq,u]));
    for(const u of observation.updates??[])pending.set(u.seq,u);
    this.#db.exec('BEGIN IMMEDIATE');
    try{this.put('pendingUpdates',[...pending.values()].sort((a,b)=>a.seq-b.seq));this.put('observation',observation);this.put('deliveredCursor',Math.max(this.get('deliveredCursor')??0,page.nextCursor));this.#db.exec('COMMIT');}catch(e){this.#db.exec('ROLLBACK');throw e;}
    this.observation=observation;this.#state(observation.status!=='active'?'ended':observation.control?.required?'your-turn':'waiting');
  }
  /** Includes every event not yet actually delivered to a decision adapter. */
  context() {
    const observation=modelObservation(this.observation),updates=this.get('pendingUpdates')??[];
    observation.updates=updates;
    const context={protocol:'coop-player/v1',runtime:this.#transport==='sse'?'sse-post-v1':'long-poll-post-v1',rules:this.rules,observation,lastActionResult:this.get('lastActionResult')};
    // Keep history through a host/provider failure. Clear only after a model
    // request is durable, or an external adapter acknowledges with an answer.
    this.put('offeredContext',{observationId:observation.observationId,through:updates.at(-1)?.seq??0});return context;
  }
  async #stream() {
    const response=await this.#fetch(`${this.#config.apiUrl}/episodes/${this.room.episodeId}/events?after=${this.get('deliveredCursor')??this.observation?.updateCursor??0}`,{
      redirect:'error',headers:{Authorization:`Bearer ${this.#config.playerToken}`,Accept:'text/event-stream'},signal:this.#stop.signal});
    if(!response.ok)throw Object.assign(Error(`Event stream HTTP ${response.status}`),{status:response.status});
    if(!response.headers.get('content-type')?.startsWith('text/event-stream'))throw Error('Expected SSE response.');
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    try{while(!this.#stop.signal.aborted){
      const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
      if(buffer.length>8*1024*1024)throw Error('Event exceeds buffer limit.');
      let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
        const data=event.split('\n').filter(s=>s.startsWith('data: ')).map(s=>s.slice(6)).join('\n');if(!data)continue;
        const packet=JSON.parse(data);if(Number.isFinite(packet.serverTime))this.#clockOffset=packet.serverTime-Date.now();this.#accept(observationPage(packet,this.get('deliveredCursor')??0).observation);await this.#drainPages();this.emit('observation',this.snapshot());
      }
    }}finally{await reader.cancel().catch(()=>{});}
  }
  async #drainPages() {
    while(this.observation?.hasMore&&!this.#stop.signal.aborted){
      const cursor=this.get('deliveredCursor')??0;
      const page=observationPage(await this.#request(`/episodes/${this.room.episodeId}/observation?after=${cursor}`),cursor);
      this.#accept(page.observation);
    }
  }
  async #poll() {
    while(!this.#stop.signal.aborted){
      const cursor=this.get('deliveredCursor')??this.observation?.nextCursor??0;
      const packet=await this.#request(`/episodes/${this.room.episodeId}/wait?after=${cursor}&timeoutMs=25000`,undefined,undefined,undefined,35000);
      if(Number.isFinite(packet.serverTime))this.#clockOffset=packet.serverTime-Date.now();
      this.#accept(observationPage(packet,cursor).observation);await this.#drainPages();this.emit('observation',this.snapshot());
      if(this.observation?.status!=='active')return;
      // A required decision can make wait return immediately while the model
      // is still running. Bound this client-side loop without changing budget.
      if(this.observation?.control?.required)await wait(200,undefined,{signal:this.#stop.signal});
    }
  }
  async #openEpisode() {
    if(this.#recorder)return;
    this.rules=await this.#request(`/episodes/${this.room.episodeId}/rules`);
    this.#recorder=await AgentMessageRecorder.open({baseUrl:this.#config.apiUrl,episodeId:this.room.episodeId,seatToken:this.#config.playerToken,
      outboxFile:join(this.#config.directory,'messages.jsonl'),scope:'Exact JSON model requests/responses and executed tool calls/results captured by this seat runtime. Unavailable provider internals and external-agent hidden thinking are excluded.',retries:1,timeoutMs:5000},{fetchImpl:this.#fetch});
    this.#recorder.resume().catch(()=>{});
    // Resolve an ambiguous pre-crash POST with its original key and payload first.
    if(this.get('pendingAction'))await this.#sendPending();
  }
  run() {
    if(this.#running)return this.#running;
    this.#retry=setInterval(async()=>{
      if(this.#stop.signal.aborted||!this.#recorder||this.#actionBusy||!this.get('pendingAction'))return;
      this.#actionBusy=true;try{await this.#sendPending();this.emit('observation',this.snapshot());}catch{}finally{this.#actionBusy=false;}
    },2000);this.#retry.unref();
    this.#running=(async()=>{
      let failures=0;
      while(!this.#stop.signal.aborted){
        try{
          this.room=await this.#request(`/rooms/${this.#config.roomId}`);this.emit('state',this.snapshot());
          if(['expired','cancelled'].includes(this.room.status)){this.#state('room-closed');return;}
          if(!this.room.episodeId){await wait(1500,undefined,{signal:this.#stop.signal});continue;}
          await this.#openEpisode();
          if(this.#transport==='sse')await this.#stream();
          else {try{await this.#poll();}catch(error){if([404,405].includes(error.status)&&this.#config.transport!=='long-poll'){this.#transport='sse';await this.#stream();}else throw error;}}
          failures=0;
          if(this.observation?.status!=='active'){
            await this.#decisionTask?.catch(()=>{});
            if(this.get('pendingAction'))await this.#sendPending();
            await Promise.allSettled(this.#recorderTasks);await this.#recorder.seal({completeness:'partial',reasoningAvailability:this.get('reasoningAvailability')??'not-provided',unavailable:['External agent internals are not captured; provider reasoning, when returned, is present in individual raw responses.']}).catch(()=>{});
            this.#state('ended');return;
          }
        }catch(error){
          if(this.#stop.signal.aborted)return;
          if([401,403,404].includes(error.status)){this.#state('access-denied');return;}
          this.#state('reconnecting');this.emit('connection-warning',error.code??'NETWORK_ERROR');failures++;
        }
        await wait(Math.min(1000*2**Math.min(failures,4),10000),undefined,{signal:this.#stop.signal}).catch(()=>{});
      }
    })();return this.#running;
  }
  async #sendPending() {
    const pending=this.get('pendingAction');if(!pending)return;
    try{
      const data=await this.#request(`/episodes/${this.room.episodeId}/actions`,pending.command,undefined,pending.key);
      await this.#capture('recordToolResult',data,{observationId:pending.command.observationId,requestId:pending.key});
      this.put('pendingAction',null);this.put('lastActionResult',{accepted:true,observationId:data.observation?.observationId??null});if(data.observation)this.#accept(data.observation);return data;
    }catch(error){
      if(error.status&&error.status<500&&error.status!==429){
        await this.#capture('recordToolResult',error.data,{observationId:pending.command.observationId,requestId:pending.key});this.put('pendingAction',null);
        this.put('lastActionResult',error.data);
        if([400,409].includes(error.status))this.emit('action-rejected',error);
      }else await this.#capture('recordToolResult',{accepted:null,error:{code:error.code??(this.#stop.signal.aborted?'CANCELLED':'TRANSPORT_ERROR')},retryable:true,requestId:pending.key},{observationId:pending.command.observationId,requestId:pending.key});
      throw error;
    }
  }
  async act(action,observationId,decisionSummary) {
    if(this.#actionBusy)throw Error('Action already submitting.');
    if(!this.observation||this.observation.status!=='active')throw Error('No active game.');
    if(this.observation.hasMore)throw Object.assign(Error('Observation history is still downloading.'),{code:'HISTORY_INCOMPLETE'});
    if(observationId!==this.observation.observationId)throw Object.assign(Error('Observation changed; decide from the new view.'),{code:'STALE_OBSERVATION'});
    this.#actionBusy=true;
    try{
      if(this.get('pendingAction'))return await this.#sendPending();
      const key=randomUUID(),command={observationId,decisionToken:this.observation.decisionToken,action,...(decisionSummary?{decisionSummary}:{})};
      this.put('pendingAction',{key,command});await this.#capture('recordToolCall',{tool:'act',action,...(decisionSummary?{decisionSummary}:{})},{observationId,requestId:key});
      this.#state('submitting');return await this.#sendPending();
    }finally{this.#actionBusy=false;}
  }
  /** Strategy adapters are serial per seat. They may return wait without POST. */
  attachAgent(agent) {
    let lastDecision='';
    const wake=async()=>{
      const obs=this.observation;if(!obs||obs.status!=='active'||obs.hasMore||this.#modelBusy||!obs.legalActions.length||this.get('pendingAction'))return;
      if(lastDecision===obs.observationId)return;lastDecision=obs.observationId;
      this.#modelBusy=true;this.#state('thinking');
      // Use the remaining absolute server budget, including the episode cap.
      // A reconnect or corrective decision must not start a new duration.
      const deadlines=[obs.control?.deadlineAt,obs.control?.episodeDeadlineAt].filter(Number.isFinite);
      const ms=Math.max(1,Math.floor(deadlines.length?Math.min(...deadlines)-Date.now()-this.#clockOffset:600000));
      try{
        const key=name=>{if(typeof name!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(name))throw Error('Invalid strategy state key.');return `strategy:${name}`;};
        const facade=Object.freeze({get:name=>this.get(key(name)),put:(name,value)=>{if(JSON.stringify(value).length>8*1024*1024)throw Error('Strategy state exceeds 8 MiB.');this.put(key(name),value);},
          recordModelRequest:(raw,details)=>this.recordModelRequest(raw,details),recordModelResponse:(raw,details)=>this.recordModelResponse(raw,details),recordTransportResult:(raw,details)=>this.recordTransportResult(raw,details)});
        const context=this.context(),answer=await agent.decide(context,{signal:AbortSignal.any([this.#stop.signal,AbortSignal.timeout(ms)]),runtime:facade});
        this.#ackContext(obs.observationId);
        if(answer?.action)await this.act(answer.action,obs.observationId,answer.decisionSummary);
      }catch(error){
        if(error.code==='STALE_OBSERVATION'&&!this.get('pendingAction')){
          const result={accepted:false,error:{code:'STALE_OBSERVATION',message:'Visible state changed before local submission; no command was sent.'}};
          this.put('lastActionResult',result);await this.#capture('recordToolResult',result,{observationId:obs.observationId});
        }
        // A rule rejection is a tool result, not a reason to wait forever for
        // a board update which may never happen. Allow one corrective decision
        // in this required window, without changing its server deadline.
        if([400,409].includes(error.status)&&!this.get('pendingAction')&&this.observation?.status==='active'){
          const windowId=obs.control?.windowId??obs.observationId,used=this.get('rejectedWindow');
          if(used!==windowId){this.put('rejectedWindow',windowId);
            try{this.#accept(await this.#request(`/episodes/${this.room.episodeId}/observation?after=${this.observation.updateCursor??0}`));lastDecision='';}catch{}
          }
        }
        this.emit('agent-warning',error.code??'AGENT_DECISION_FAILED');
      }
      finally{this.#modelBusy=false;if(this.observation?.status==='active')this.#state(this.observation.control?.required?'your-turn':'waiting');else this.#state('ended');
        if(this.observation&&this.observation.observationId!==lastDecision&&!this.#stop.signal.aborted)queueMicrotask(listener);}
    };
    const listener=()=>{if(!this.#modelBusy)this.#decisionTask=wake();};
    const retryRejected=async()=>{
      if(this.#modelBusy||this.#stop.signal.aborted||this.observation?.status!=='active')return;
      const windowId=this.observation.control?.windowId??this.observation.observationId;
      if(this.get('rejectedWindow')===windowId)return;this.put('rejectedWindow',windowId);
      try{this.#accept(await this.#request(`/episodes/${this.room.episodeId}/observation?after=${this.observation.updateCursor??0}`));lastDecision='';listener();}catch{}
    };
    this.on('observation',listener);this.on('action-rejected',retryRejected);
    return ()=>{this.off('observation',listener);this.off('action-rejected',retryRejected);};
  }
  close() {return this.#closing??=(async()=>{this.#stop.abort();clearInterval(this.#retry);await this.#decisionTask?.catch(()=>{});await this.#running?.catch(()=>{});await this.#recorder?.close();this.#db.close();})();}
}
