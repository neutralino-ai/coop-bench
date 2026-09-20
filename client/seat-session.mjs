import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { AgentMessageRecorder } from '../scripts/agent-message-recorder.mjs';
import { apiUrl, jsonResponse, observationPage } from './protocol.mjs';

const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
const scope='Actual MCP/HTTP player tool requests and results recorded by the seat bridge. The bridge cannot observe host model messages or hidden reasoning; those require a separate provider-aware recorder.';
const checkId=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,100}$/.test(value);

/** One direct episode client, one private local journal, one seat capability.
 * An unresolved POST is persisted before I/O and reused verbatim after restart. */
export class SeatSession {
  #config;#fetch;#db;#recorder;#stop=new AbortController();#pendingWrites=[];#operations=new Set();#closed=false;#closing;#acting=false;#waiting=false;
  static async open(config,dependencies={}) {
    const client=new SeatSession(config,dependencies);
    try {
      client.#recorder=await AgentMessageRecorder.open({baseUrl:client.#config.apiUrl,episodeId:config.episodeId,seatToken:config.seatToken,
        outboxFile:join(config.directory,'mcp-messages.jsonl'),scope,retries:0,timeoutMs:5000},{fetchImpl:client.#fetch});
      client.#recorder.resume().catch(()=>{});return client;
    }catch(error){client.#db.close();throw error;}
  }
  constructor(config,{fetchImpl=fetch}={}) {
    if(!checkId(config.episodeId)||typeof config.seatToken!=='string'||config.seatToken.length<16||config.seatToken.length>256||!config.directory)throw Error('An episode, private seat token and private directory are required.');
    this.#config={...config,apiUrl:apiUrl(config.apiUrl)};this.#fetch=fetchImpl;
    mkdirSync(config.directory,{recursive:true,mode:0o700});const file=join(config.directory,'seat-session.sqlite');this.#db=new DatabaseSync(file);chmodSync(file,0o600);
    this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,command TEXT NOT NULL,result TEXT);');
    const binding=createHash('sha256').update(JSON.stringify([this.#config.apiUrl,config.episodeId,config.seatToken])).digest('hex');
    if(this.#get('binding')&&this.#get('binding')!==binding){this.#db.close();throw Error('This private directory belongs to another seat.');}this.#put('binding',binding);
  }
  #get(key){const value=this.#db.prepare('SELECT value FROM state WHERE key=?').get(key);return value?JSON.parse(value.value):null;}
  #put(key,value){this.#db.prepare('INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
  get cursor(){return this.#get('cursor')??0;}
  get traceStatus(){return this.#recorder.status();}
  #record(method,value,details={}){
    // record* fsyncs its local outbox before returning the uploading promise.
    const promise=this.#recorder[method](value,details).catch(()=>{});this.#pendingWrites.push(promise);
    if(this.#pendingWrites.length>32)this.#pendingWrites.splice(0,16);
  }
  async #request(path,{body,key,signal,timeoutMs=15000}={}){
    if(this.#closed)throw Error('Seat session is closed.');
    const response=await this.#fetch(this.#config.apiUrl+path,{method:body===undefined?'GET':'POST',redirect:'error',
      headers:{Authorization:`Bearer ${this.#config.seatToken}`,...(body===undefined?{}:{'Content-Type':'application/json'}),...(key?{'Idempotency-Key':key}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.any([this.#stop.signal,AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])])});
    const data=await jsonResponse(response);
    return {httpStatus:response.status,...data};
  }
  #requireSuccess(result){if(result.httpStatus>=400)throw Object.assign(Error(result.error?.message??`HTTP ${result.httpStatus}`),{status:result.httpStatus,code:result.error?.code,data:result});return result;}
  #track(work){
    if(this.#closed)return Promise.reject(Error('Seat session is closed.'));
    const operation=(async()=>work())();this.#operations.add(operation);operation.finally(()=>this.#operations.delete(operation)).catch(()=>{});return operation;
  }
  rules(options={}){return this.#track(()=>this.#rules(options));}
  wait(options={}){return this.#track(()=>this.#wait(options));}
  act(args,options={}){return this.#track(()=>this.#act(args,options));}
  async #rules({signal}={}){
    const requestId=randomUUID();this.#record('recordToolCall',{tool:'rules'},{requestId});
    try {
      const result=this.#requireSuccess(await this.#request(`/episodes/${encodeURIComponent(this.#config.episodeId)}/rules`,{signal}));
      this.#record('recordToolResult',result,{requestId});return result;
    }catch(error){this.#record('recordToolResult',{error:{code:signal?.aborted?'CANCELLED':error.code??'TRANSPORT_ERROR'}},{requestId});throw error;}
  }
  async #wait({cursor=this.cursor,timeoutMs=25000,signal}={}){
    if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isInteger(timeoutMs)||timeoutMs<0||timeoutMs>50000)throw Error('cursor must be nonnegative and timeoutMs must be 0–50000.');
    if(this.#waiting)throw Error('A seat wait is already in flight.');this.#waiting=true;
    const requestId=randomUUID();this.#record('recordToolCall',{tool:'wait',cursor,timeoutMs},{requestId});
    try {
      const result=this.#requireSuccess(await this.#request(`/episodes/${encodeURIComponent(this.#config.episodeId)}/wait?after=${cursor}&timeoutMs=${timeoutMs}`,{signal,timeoutMs:timeoutMs+10000}));
      signal?.throwIfAborted();this.#stop.signal.throwIfAborted();
      const page=observationPage(result,cursor),pending=this.#db.prepare('SELECT id,command FROM requests WHERE result IS NULL LIMIT 1').get();
      // A freshly restarted host need not remember an ambiguous POST from its
      // previous context. Return the exact retryable intent, never credentials.
      if(pending){const {decisionToken,action,decisionSummary}=JSON.parse(pending.command);page.pendingAction={requestId:pending.id,decisionToken,action,...(decisionSummary?{decisionSummary}:{})};}
      this.#record('recordToolResult',page,{requestId,observationId:page.observation.observationId});
      // Explicit requests for old pages may be replayed, but never rewind the
      // journal or lose the most recent usable decision observation.
      if(page.nextCursor>=this.cursor){this.#db.exec('BEGIN IMMEDIATE');try{this.#put('cursor',page.nextCursor);this.#put('observation',page.observation);this.#db.exec('COMMIT');}catch(error){this.#db.exec('ROLLBACK');throw error;}}
      return page;
    }catch(error){this.#record('recordToolResult',{error:{code:signal?.aborted||this.#stop.signal.aborted?'CANCELLED':error.code??'TRANSPORT_ERROR'},retryable:!error.status||error.status>=500},{requestId});throw error;}
    finally{this.#waiting=false;}
  }
  /** The host/model supplies a stable intent identifier, not a token hash.
   * Reusing an ID for changed arguments is rejected even after restart. */
  async #act({requestId,decisionToken,action,decisionSummary},{signal}={}){
    if(this.#acting)throw Error('A seat action is already in flight.');
    if(!checkId(requestId)||typeof decisionToken!=='string'||!action||typeof action!=='object'||Array.isArray(action)||typeof action.type!=='string'||decisionSummary!==undefined&&(typeof decisionSummary!=='string'||decisionSummary.length>1200))throw Error('Invalid action arguments.');
    const fingerprint=canonical({decisionToken,action,decisionSummary:decisionSummary??null});
    let entry=this.#db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
    if(entry&&entry.fingerprint!==fingerprint)throw Object.assign(Error('The request ID belongs to different action arguments.'),{code:'IDEMPOTENCY_CONFLICT'});
    if(entry?.result)return JSON.parse(entry.result);
    if(!entry){
      if(this.#db.prepare('SELECT id FROM requests WHERE result IS NULL LIMIT 1').get())throw Object.assign(Error('Retry the unresolved request with its original requestId and arguments before another action.'),{code:'PENDING_ACTION'});
      const observation=this.#get('observation');
      if(!observation||observation.decisionToken!==decisionToken)throw Object.assign(Error('Call wait and use its current decision token.'),{code:'STALE_OBSERVATION'});
      if(observation.hasMore)throw Object.assign(Error('Read all remaining observation pages before deciding.'),{code:'HISTORY_INCOMPLETE'});
      const command={observationId:observation.observationId,decisionToken,action,...(decisionSummary?{decisionSummary}:{})};
      this.#db.prepare('INSERT INTO requests(id,fingerprint,command) VALUES(?,?,?)').run(requestId,fingerprint,JSON.stringify(command));entry={command:JSON.stringify(command)};
    }
    const command=JSON.parse(entry.command);this.#acting=true;
    this.#record('recordToolCall',{tool:'act',requestId,decisionToken,action,...(decisionSummary?{decisionSummary}:{})},{requestId,observationId:command.observationId});
    try {
      const result=await this.#request(`/episodes/${encodeURIComponent(this.#config.episodeId)}/actions`,{body:command,key:requestId,signal});
      this.#record('recordToolResult',result,{requestId,observationId:command.observationId});
      if(result.httpStatus<500&&result.httpStatus!==429)this.#db.prepare('UPDATE requests SET result=? WHERE id=?').run(JSON.stringify(result),requestId);
      // Receipts can contain an old projection on duplicate POSTs. Only wait
      // advances the observation cursor; never skip intervening history here.
      return result;
    }catch(error){this.#record('recordToolResult',{error:{code:signal?.aborted?'CANCELLED':'TRANSPORT_ERROR'},retryable:true,requestId},{requestId,observationId:command.observationId});throw error;}
    finally{this.#acting=false;}
  }
  close(){return this.#closing??=(async()=>{this.#closed=true;this.#stop.abort();await Promise.allSettled([...this.#operations]);await Promise.allSettled(this.#pendingWrites);await this.#recorder.close();this.#db.close();})();}
}
