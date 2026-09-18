import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { check, object } from './common.ts';
import type { JsonObject } from './types.ts';

export interface MessageLimits {maxMessageBytes:number;maxMessagesPerSeat:number;maxMessageStoredBytesTotal:number;}
export const DEFAULT_MESSAGE_LIMITS:Readonly<MessageLimits>=Object.freeze({maxMessageBytes:48*1024,maxMessagesPerSeat:10000,maxMessageStoredBytesTotal:1024*1024*1024});
export type ReasoningAvailability='provided'|'summary-only'|'not-provided'|'redacted';
export interface ClientMessage {
  sequence:number;messageId:string;
  /** Unmodified structured provider message; content and tool_calls are not flattened. */
  message:JsonObject;
  kind?:'model-input'|'model-output'|'tool-call'|'tool-result';
  model?:string;provider?:string;requestId?:string;observationId?:string;
  tokenUsage?:JsonObject;reasoningAvailability?:ReasoningAvailability;clientAt?:string;
}
export interface ClientMessageCompletion {
  scope:string;completeness:'complete'|'partial';reasoningAvailability:ReasoningAvailability;
  model?:string;provider?:string;unavailable?:string[];
}
interface MessageRow {episode_id:string;player_id:string;sequence:number;message_id:string;payload:string;payload_hash:string;received_at:string;stored_bytes:number;}
interface CompletionRow {episode_id:string;player_id:string;payload:string;payload_hash:string;sealed_at:string;last_sequence:number;stored_bytes:number;}
const canonical=(v:any):string=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:object(v)?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const provenance='client-supplied-unverified' as const;
const reasoning=['provided','summary-only','not-provided','redacted'];
function json(value:unknown):void {
  const pending:[unknown,number][]=[[value,0]];let count=0;
  while(pending.length){
    const [entry,depth]=pending.pop()!;
    check(++count<=8192&&depth<=32,'Message JSON exceeds the allowed complexity.','TOO_LARGE');
    if(entry===null||typeof entry==='string'||typeof entry==='boolean')continue;
    if(typeof entry==='number'){check(Number.isFinite(entry),'Message JSON numbers must be finite.','INVALID_REQUEST');continue;}
    check(Array.isArray(entry)||object(entry),'Only plain JSON data can be recorded.','INVALID_REQUEST');
    for(const [key,child] of Object.entries(entry)){
      check(!['__proto__','constructor','prototype'].includes(key),'Reserved message JSON key.','INVALID_REQUEST');pending.push([child,depth+1]);
    }
  }
}
function shortText(value:unknown,max=200):boolean{return typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);}

/** Private append-only client capture. No game adapters, clocks, event feeds or
 * player communication are invoked here. Completeness is a client claim only. */
export class MessageStore {
  readonly db:DatabaseSync;readonly limits:Readonly<MessageLimits>;
  constructor(db:DatabaseSync,limits:Partial<MessageLimits>={}) {
    this.db=db;this.limits=Object.freeze({...DEFAULT_MESSAGE_LIMITS,...limits});
    for(const value of Object.values(this.limits))check(Number.isSafeInteger(value)&&value>0,'Message budgets must be positive safe integers.','INVALID_CONFIG');
    check(this.limits.maxMessageBytes<=48*1024,'Messages cannot exceed the 48 KiB safety ceiling.','INVALID_CONFIG');
    this.db.exec(`CREATE TABLE IF NOT EXISTS agent_messages(
      episode_id TEXT NOT NULL,player_id TEXT NOT NULL,sequence INTEGER NOT NULL CHECK(sequence>=0),message_id TEXT NOT NULL,
      payload TEXT NOT NULL,payload_hash TEXT NOT NULL,received_at TEXT NOT NULL,stored_bytes INTEGER NOT NULL,
      PRIMARY KEY(episode_id,player_id,sequence),UNIQUE(episode_id,player_id,message_id),FOREIGN KEY(episode_id,player_id) REFERENCES seats(episode_id,player_id));
      CREATE TABLE IF NOT EXISTS agent_message_completions(
      episode_id TEXT NOT NULL,player_id TEXT NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,sealed_at TEXT NOT NULL,last_sequence INTEGER NOT NULL,stored_bytes INTEGER NOT NULL,
      PRIMARY KEY(episode_id,player_id),FOREIGN KEY(episode_id,player_id) REFERENCES seats(episode_id,player_id));
      CREATE TABLE IF NOT EXISTS agent_message_storage(id INTEGER PRIMARY KEY CHECK(id=1),bytes INTEGER NOT NULL,messages INTEGER NOT NULL,seals INTEGER NOT NULL);
      INSERT OR IGNORE INTO agent_message_storage SELECT 1,
        (SELECT COALESCE(SUM(stored_bytes),0) FROM agent_messages)+(SELECT COALESCE(SUM(stored_bytes),0) FROM agent_message_completions),
        (SELECT COUNT(*) FROM agent_messages),(SELECT COUNT(*) FROM agent_message_completions);
      CREATE TRIGGER IF NOT EXISTS agent_messages_insert AFTER INSERT ON agent_messages BEGIN UPDATE agent_message_storage SET bytes=bytes+NEW.stored_bytes,messages=messages+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS agent_message_completions_insert AFTER INSERT ON agent_message_completions BEGIN UPDATE agent_message_storage SET bytes=bytes+NEW.stored_bytes,seals=seals+1 WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS agent_messages_no_update BEFORE UPDATE ON agent_messages BEGIN SELECT RAISE(ABORT,'Client messages are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS agent_messages_no_delete BEFORE DELETE ON agent_messages BEGIN SELECT RAISE(ABORT,'Client messages are retained indefinitely'); END;
      CREATE TRIGGER IF NOT EXISTS agent_message_completions_no_update BEFORE UPDATE ON agent_message_completions BEGIN SELECT RAISE(ABORT,'Client message completion is immutable'); END;
      CREATE TRIGGER IF NOT EXISTS agent_message_completions_no_delete BEFORE DELETE ON agent_message_completions BEGIN SELECT RAISE(ABORT,'Client message completion is retained indefinitely'); END;`);
  }
  private transaction<T>(run:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const value=run();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  private validate(input:unknown):ClientMessage {
    json(input);check(object(input),'Message envelope must be an object.','INVALID_REQUEST');
    const fields=['sequence','messageId','message','kind','model','provider','requestId','observationId','tokenUsage','reasoningAvailability','clientAt'];
    check(Object.keys(input).every(k=>fields.includes(k)),'Unknown message envelope field.','INVALID_REQUEST');
    check(Number.isSafeInteger(input.sequence)&&input.sequence>=0,'sequence must be a nonnegative integer starting at zero.','INVALID_REQUEST');
    check(typeof input.messageId==='string'&&/^[A-Za-z0-9._:-]{1,100}$/.test(input.messageId),'messageId must be a 1–100 character stable identifier.','INVALID_REQUEST');
    check(object(input.message)&&shortText(input.message.role,64),'message must be the raw provider object with a role string.','INVALID_REQUEST');
    // Provider role names can differ (for example developer); retain their raw schema.
    if(input.kind!==undefined)check(['model-input','model-output','tool-call','tool-result'].includes(input.kind),'Invalid message kind.','INVALID_REQUEST');
    for(const key of ['model','provider','requestId','observationId'])if(input[key]!==undefined)check(shortText(input[key]),`Invalid message ${key}.`,'INVALID_REQUEST');
    if(input.reasoningAvailability!==undefined)check(reasoning.includes(input.reasoningAvailability),'Invalid reasoning availability.','INVALID_REQUEST');
    if(input.tokenUsage!==undefined)check(object(input.tokenUsage)&&Buffer.byteLength(canonical(input.tokenUsage))<=4096,'tokenUsage must be a provider usage object of at most 4 KiB.','INVALID_REQUEST');
    if(input.clientAt!==undefined)check(typeof input.clientAt==='string'&&input.clientAt.length<=64&&/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(input.clientAt)&&Number.isFinite(Date.parse(input.clientAt)),'clientAt must be an ISO timestamp with timezone.','INVALID_REQUEST');
    check(Buffer.byteLength(canonical(input))<=48*1024,'A message envelope may be at most 48 KiB; upload larger originals as chunked artifacts.','TOO_LARGE');
    return input as ClientMessage;
  }
  private record(row:MessageRow) {return {...JSON.parse(row.payload),episodeId:row.episode_id,playerId:row.player_id,serverReceivedAt:row.received_at,provenance};}
  private sealRecord(row:CompletionRow|undefined) {return row?{...JSON.parse(row.payload),episodeId:row.episode_id,playerId:row.player_id,sealedAt:row.sealed_at,lastSequence:row.last_sequence,provenance}:null;}
  private checkCapacity(additional:number):void {
    const used=Number(this.db.prepare('SELECT bytes FROM agent_message_storage WHERE id=1').get()!.bytes);
    check(additional<=this.limits.maxMessageStoredBytesTotal-used,'Private message storage budget reached. Existing messages and game state are retained; increase capacity for new writes.','RESOURCE_LIMIT');
  }
  append(episodeId:string,playerId:string,input:unknown) {
    const message=this.validate(input),payload=canonical(message),hash=digest(payload),bytes=Buffer.byteLength(payload)+128;
    return this.transaction(()=>{
      const old=this.db.prepare('SELECT * FROM agent_messages WHERE episode_id=? AND player_id=? AND sequence=?').get(episodeId,playerId,message.sequence) as unknown as MessageRow|undefined;
      if(old){check(old.payload_hash===hash,'This sequence already contains a different message.','IDEMPOTENCY_CONFLICT');return this.record(old);}
      check(!this.db.prepare('SELECT 1 FROM agent_message_completions WHERE episode_id=? AND player_id=?').get(episodeId,playerId),'This private message stream has been sealed.','MESSAGES_SEALED');
      check(!this.db.prepare('SELECT 1 FROM agent_messages WHERE episode_id=? AND player_id=? AND message_id=?').get(episodeId,playerId,message.messageId),'messageId is already assigned to another sequence.','MESSAGE_ID_CONFLICT');
      const last=this.db.prepare('SELECT sequence FROM agent_messages WHERE episode_id=? AND player_id=? ORDER BY sequence DESC LIMIT 1').get(episodeId,playerId);
      const next=last?Number(last.sequence)+1:0;
      check(message.sequence===next,`Expected next message sequence ${next}.`,'MESSAGE_SEQUENCE_CONFLICT');
      check(next<this.limits.maxMessagesPerSeat,'Message count budget reached for this seat; existing messages are retained.','RESOURCE_LIMIT');
      check(Buffer.byteLength(payload)<=this.limits.maxMessageBytes,'Message exceeds the configured per-message budget.','RESOURCE_LIMIT');this.checkCapacity(bytes);
      const received=new Date().toISOString();
      this.db.prepare('INSERT INTO agent_messages VALUES(?,?,?,?,?,?,?,?)').run(episodeId,playerId,message.sequence,message.messageId,payload,hash,received,bytes);
      return this.record({episode_id:episodeId,player_id:playerId,sequence:message.sequence,message_id:message.messageId,payload,payload_hash:hash,received_at:received,stored_bytes:bytes});
    });
  }
  complete(episodeId:string,playerId:string,input:unknown) {
    json(input);check(object(input),'Message completion must be an object.','INVALID_REQUEST');
    check(Object.keys(input).every(k=>['scope','completeness','reasoningAvailability','model','provider','unavailable'].includes(k)),'Unknown message completion field.','INVALID_REQUEST');
    check(typeof input.scope==='string'&&input.scope.trim().length>0&&input.scope.length<=2000,'Describe the scope actually captured.','INVALID_REQUEST');
    check(['complete','partial'].includes(input.completeness),'completeness must be complete or partial.','INVALID_REQUEST');
    check(reasoning.includes(input.reasoningAvailability),'Invalid reasoning availability.','INVALID_REQUEST');
    for(const key of ['model','provider'])if(input[key]!==undefined)check(shortText(input[key]),`Invalid completion ${key}.`,'INVALID_REQUEST');
    if(input.unavailable!==undefined)check(Array.isArray(input.unavailable)&&input.unavailable.length<=16&&input.unavailable.every(v=>shortText(v,200)),'unavailable must list at most 16 short unavailable fields.','INVALID_REQUEST');
    const payload=canonical(input),hash=digest(payload),bytes=Buffer.byteLength(payload)+128;
    check(bytes<=8192,'Message completion metadata is too large.','TOO_LARGE');
    return this.transaction(()=>{
      const old=this.db.prepare('SELECT * FROM agent_message_completions WHERE episode_id=? AND player_id=?').get(episodeId,playerId) as unknown as CompletionRow|undefined;
      if(old){check(old.payload_hash===hash,'This stream was sealed with different metadata.','IDEMPOTENCY_CONFLICT');return this.sealRecord(old);}
      this.checkCapacity(bytes);
      const last=this.db.prepare('SELECT sequence FROM agent_messages WHERE episode_id=? AND player_id=? ORDER BY sequence DESC LIMIT 1').get(episodeId,playerId),lastSequence=last?Number(last.sequence):-1;
      const sealedAt=new Date().toISOString();this.db.prepare('INSERT INTO agent_message_completions VALUES(?,?,?,?,?,?,?)').run(episodeId,playerId,payload,hash,sealedAt,lastSequence,bytes);
      return this.sealRecord({episode_id:episodeId,player_id:playerId,payload,payload_hash:hash,sealed_at:sealedAt,last_sequence:lastSequence,stored_bytes:bytes});
    });
  }
  list(episodeId:string,playerId:string,after=-1,limit=50) {
    check(Number.isSafeInteger(after)&&after>=-1,'after must be the last received sequence, or -1.','INVALID_REQUEST');
    check(Number.isInteger(limit)&&limit>=1&&limit<=100,'limit must be between 1 and 100.','INVALID_REQUEST');
    const page:MessageRow[]=[];let bytes=0,hasMore=false;
    for(const entry of this.db.prepare('SELECT * FROM agent_messages WHERE episode_id=? AND player_id=? AND sequence>? ORDER BY sequence LIMIT ?').iterate(episodeId,playerId,after,limit+1)){
      const row=entry as unknown as MessageRow;
      if(page.length>=limit||bytes+row.stored_bytes>512*1024){hasMore=true;break;}
      page.push(row);bytes+=row.stored_bytes;
    }
    const seal=this.db.prepare('SELECT * FROM agent_message_completions WHERE episode_id=? AND player_id=?').get(episodeId,playerId) as unknown as CompletionRow|undefined;
    return {episodeId,playerId,messages:page.map(row=>this.record(row)),nextAfter:page.length?page[page.length-1].sequence:after,hasMore,completion:this.sealRecord(seal),retention:this.retention(false)};
  }
  summary(episodeId:string) {
    const seats=this.db.prepare('SELECT player_id FROM seats WHERE episode_id=? ORDER BY player_id').all(episodeId);
    return {episodeId,seats:seats.map(seat=>{
      const row=this.db.prepare('SELECT COUNT(*) AS n,COALESCE(MAX(sequence),-1) AS last FROM agent_messages WHERE episode_id=? AND player_id=?').get(episodeId,seat.player_id)!;
      const seal=this.db.prepare('SELECT * FROM agent_message_completions WHERE episode_id=? AND player_id=?').get(episodeId,seat.player_id) as unknown as CompletionRow|undefined;
      return {playerId:seat.player_id,messageCount:Number(row.n),lastSequence:Number(row.last),completion:this.sealRecord(seal)};
    }),retention:this.retention(false)};
  }
  retention(includeUsage=true) {
    const usage=includeUsage?this.db.prepare('SELECT * FROM agent_message_storage WHERE id=1').get():undefined;
    return {policy:'indefinite',automaticDeletion:false,automaticExpiry:false,onCapacity:'reject-new-writes',...this.limits,
      ...(usage?{storedBytes:Number(usage.bytes),messageCount:Number(usage.messages),sealedStreamCount:Number(usage.seals)}:{}),
      maxPagePayloadBytes:512*1024,visibility:'Only the uploading seat and authorized human auditors. Never broadcast to players or applied as game actions.',provenance,
      accounting:'Canonical envelope payload plus 128 bytes per message or seal; SQLite pages, indexes, WAL and backups need additional disk space.',
      evidenceBoundary:'Client-captured structured messages. Client timestamps, completeness, model identity, usage and reasoning are self-reported; unavailable internal reasoning is not reconstructed.'};
  }
}
