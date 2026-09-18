import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check, clone, exactKeys, object, players, RuleError } from './common.ts';
import type { Action, GameAdapter, JsonObject, Outcome, SetupOptions } from './types.ts';
import { DEFAULT_ROLLOUT_LIMITS, RolloutStore, type RolloutLimits } from './rollout-store.ts';
import { ArtifactStore, DEFAULT_ARTIFACT_LIMITS, type ArtifactLimits } from './artifact-store.ts';
import { MessageStore, DEFAULT_MESSAGE_LIMITS, type MessageLimits } from './message-store.ts';

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
const secret = (): string => randomBytes(32).toString('base64url');
const now = (): string => new Date().toISOString();
declare const __COOP_BUILD_ID__: string;
export function sourceBuild(): string {
  // The desktop build embeds the same source fingerprint; runtime needs no source tree.
  if(typeof __COOP_BUILD_ID__ !== 'undefined') return __COOP_BUILD_ID__;
  const root = fileURLToPath(new URL('.',import.meta.url));
  // v2 is a new build identity, not an alias for historical deployments. Hash
  // vendored sources too; OS path separators and Git checkout EOLs are neutral.
  const entries = readdirSync(root,{recursive:true}).filter(p=>p.endsWith('.ts'))
    .map(path=>({path,canonical:path.replaceAll('\\','/')}))
    .sort((a,b)=>a.canonical<b.canonical?-1:a.canonical>b.canonical?1:0);
  const hash = createHash('sha256').update('coop-source-build/v2\0');
  for(const entry of entries) hash.update(entry.canonical).update('\0')
    .update(readFileSync(root + entry.path,'utf8').replaceAll('\r\n','\n')).update('\0');
  return hash.digest('hex');
}
export interface Command {
  observationId: string;
  decisionToken: string;
  action: Action;
  /** Optional short player-authored reason, private audit field; not hidden reasoning. */
  decisionSummary?: string;
}
export interface Envelope {
  episodeId: string; playerId: string; observationId: string; decisionToken: string;
  status: 'active'|'completed'|'truncated';
  view: JsonObject; legalActions: ReturnType<GameAdapter['legalActions']>;
  outcome: Omit<Outcome,'details'>|null;
  /** Per-seat sequence only. Pull again with this cursor; no global event index. */
  updateCursor?: number;
  updates?: {seq:number;preparedAt:string;view:JsonObject;status:Envelope['status']}[];
}
export interface Creation { episodeId:string; gameId:string; scenarioId:string; seats:{playerId:string;token:string}[] }
interface Row { id:string; game_id:string; options:string; state:string; status:Envelope['status']; revision:number; build:string; metadata:string; end_reason:string|null }

/** Operational budgets, not game rules. Reaching one never awards a game loss. */
export interface AuthorityLimits extends RolloutLimits, ArtifactLimits, MessageLimits {
  maxEpisodes:number;
  maxActiveEpisodes:number;
  maxCommandsPerEpisode:number;
  maxEventsPerEpisode:number;
  maxObservationsPerSeat:number;
  maxStoredBytesPerEpisode:number;
  maxStoredBytesTotal:number;
}
export const DEFAULT_AUTHORITY_LIMITS:Readonly<AuthorityLimits>=Object.freeze({
  ...DEFAULT_ROLLOUT_LIMITS,...DEFAULT_ARTIFACT_LIMITS,...DEFAULT_MESSAGE_LIMITS,maxEpisodes:1000,maxActiveEpisodes:32,maxCommandsPerEpisode:1000,
  maxEventsPerEpisode:2500,maxObservationsPerSeat:2000,maxStoredBytesPerEpisode:64*1024*1024,maxStoredBytesTotal:512*1024*1024,
});

/** One local SQLite authority. BEGIN IMMEDIATE serializes writers across processes.
 * No shared event feed is exposed: only explicitly projected per-seat observations.
 */
export class Authority {
  readonly db: DatabaseSync;
  readonly adapters: Map<string,GameAdapter>;
  readonly build: string;
  readonly clock: ()=>number;
  readonly rollouts: RolloutStore;
  readonly artifacts: ArtifactStore;
  readonly messages: MessageStore;
  readonly limits:Readonly<AuthorityLimits>;
  constructor(path:string, adapters:GameAdapter[], build=sourceBuild(), clock:()=>number=Date.now, limits:Partial<AuthorityLimits>={}) {
    this.limits=Object.freeze({...DEFAULT_AUTHORITY_LIMITS,...limits});
    for(const value of Object.values(this.limits))check(Number.isSafeInteger(value)&&value>0,'Resource limits must be positive safe integers.','INVALID_CONFIG');
    this.clock=clock;
    this.build=build; this.adapters=new Map(adapters.map(a=>[a.metadata.id,a]));
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS episodes(id TEXT PRIMARY KEY,game_id TEXT NOT NULL,options TEXT NOT NULL,state TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL,build TEXT NOT NULL,metadata TEXT NOT NULL,end_reason TEXT);
      CREATE TABLE IF NOT EXISTS seats(episode_id TEXT NOT NULL REFERENCES episodes(id),player_id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,PRIMARY KEY(episode_id,player_id));
      CREATE TABLE IF NOT EXISTS views(episode_id TEXT NOT NULL,player_id TEXT NOT NULL,fingerprint TEXT NOT NULL,decision_token TEXT NOT NULL,PRIMARY KEY(episode_id,player_id));
      CREATE TABLE IF NOT EXISTS clocks(episode_id TEXT PRIMARY KEY,last_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS visible_updates(episode_id TEXT NOT NULL,player_id TEXT NOT NULL,seq INTEGER NOT NULL,prepared_at TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(episode_id,player_id,seq));
      CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY,episode_id TEXT NOT NULL,player_id TEXT NOT NULL,issued_at TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS observation_cache(episode_id TEXT NOT NULL,player_id TEXT NOT NULL,fingerprint TEXT NOT NULL,observation_id TEXT NOT NULL REFERENCES observations(id),PRIMARY KEY(episode_id,player_id,fingerprint));
      CREATE TABLE IF NOT EXISTS commands(episode_id TEXT NOT NULL,player_id TEXT NOT NULL,request_id TEXT NOT NULL,request_hash TEXT NOT NULL,http_status INTEGER NOT NULL,response TEXT NOT NULL,PRIMARY KEY(episode_id,player_id,request_id));
      CREATE TABLE IF NOT EXISTS events(episode_id TEXT NOT NULL,seq INTEGER NOT NULL,received_at TEXT NOT NULL,player_id TEXT,kind TEXT NOT NULL,payload TEXT NOT NULL,state_hash TEXT NOT NULL,PRIMARY KEY(episode_id,seq));
      CREATE INDEX IF NOT EXISTS observations_episode ON observations(episode_id,player_id);`);
    this.rollouts=new RolloutStore(this.db,this.build,this.limits);
    this.installStorageAccounting();
    this.artifacts=new ArtifactStore(this.db,{maxArtifactBytes:this.limits.maxArtifactBytes,maxArtifactsPerSeat:this.limits.maxArtifactsPerSeat,maxArtifactStoredBytesTotal:this.limits.maxArtifactStoredBytesTotal});
    this.messages=new MessageStore(this.db,{maxMessageBytes:this.limits.maxMessageBytes,maxMessagesPerSeat:this.limits.maxMessagesPerSeat,maxMessageStoredBytesTotal:this.limits.maxMessageStoredBytesTotal});
  }
  close(): void { this.db.close(); }
  /** Count persisted UTF-8 payload bytes, including repeated snapshots and receipts.
   * Triggers make accounting atomic and preserve it across process restarts. */
  private installStorageAccounting():void {
    this.db.exec('CREATE TABLE IF NOT EXISTS episode_storage(episode_id TEXT PRIMARY KEY,bytes INTEGER NOT NULL DEFAULT 0);');
    const tracked=[['episodes','id',['state','options','metadata']],['events','episode_id',['payload']],
      ['observations','episode_id',['payload']],['commands','episode_id',['response']],
      ['visible_updates','episode_id',['payload']],['rollout_frames','episode_id',['payload']],
      ['rollout_annotations','episode_id',['text']]] as const;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const missing=this.db.prepare('SELECT id FROM episodes WHERE id NOT IN (SELECT episode_id FROM episode_storage)').all();
      for(const row of missing) {
        let bytes=0;
        for(const [table,key,fields] of tracked) {
          const size=fields.map(field=>`length(CAST(${field} AS BLOB))`).join('+');
          bytes+=Number(this.db.prepare(`SELECT COALESCE(SUM(${size}),0) AS bytes FROM ${table} WHERE ${key}=?`).get(row.id)!.bytes);
        }
        this.db.prepare('INSERT INTO episode_storage VALUES(?,?)').run(row.id,bytes);
      }
      for(const [table,key,fields] of tracked) {
        const size=(prefix:string)=>fields.map(field=>`length(CAST(${prefix}.${field} AS BLOB))`).join('+');
        this.db.exec(`CREATE TRIGGER IF NOT EXISTS storage_${table}_insert AFTER INSERT ON ${table} BEGIN
          INSERT INTO episode_storage VALUES(NEW.${key},${size('NEW')}) ON CONFLICT(episode_id) DO UPDATE SET bytes=bytes+excluded.bytes; END;
          CREATE TRIGGER IF NOT EXISTS storage_${table}_update AFTER UPDATE ON ${table} BEGIN
          UPDATE episode_storage SET bytes=bytes+(${size('NEW')})-(${size('OLD')}) WHERE episode_id=NEW.${key}; END;
          CREATE TRIGGER IF NOT EXISTS storage_${table}_delete AFTER DELETE ON ${table} BEGIN
          UPDATE episode_storage SET bytes=bytes-(${size('OLD')}) WHERE episode_id=OLD.${key}; END;`);
      }
      this.db.exec('COMMIT');
    } catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  private storageBytes(id:string):number {return Number(this.db.prepare('SELECT bytes FROM episode_storage WHERE episode_id=?').get(id)?.bytes??0);}
  private totalStorageBytes():number {return Number(this.db.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes FROM episode_storage').get()!.bytes);}
  private transaction<T>(fn:()=>T,episodeId?:string,allowTerminalOverflow=false):T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const before=episodeId?this.storageBytes(episodeId):0,totalBefore=this.totalStorageBytes(),result=fn();
      if(episodeId&&!allowTerminalOverflow) {
        check(this.storageBytes(episodeId)<=Math.max(before,this.limits.maxStoredBytesPerEpisode),'Episode storage budget reached; the coordinator can truncate this attempt.','RESOURCE_LIMIT');
        check(this.totalStorageBytes()<=Math.max(totalBefore,this.limits.maxStoredBytesTotal),'Server storage budget reached. Existing history is retained; raise the configured budget to accept new writes.','RESOURCE_LIMIT');
      }
      this.db.exec('COMMIT'); return result;
    }
    catch(error){ this.db.exec('ROLLBACK'); throw error; }
  }
  private row(id:string):Row {
    const row=this.historicalRow(id);
    check(row.build===this.build,'Episode engine build differs; migrate or use the pinned build.','BUILD_MISMATCH');
    return row;
  }
  private historicalRow(id:string):Row {
    const row=this.db.prepare('SELECT * FROM episodes WHERE id=?').get(id) as unknown as Row|undefined;
    check(row,'Unknown episode.','NOT_FOUND');return row;
  }
  private adapter(row:Row):GameAdapter {
    const adapter=this.adapters.get(row.game_id); check(adapter,'Game is not installed.','NOT_FOUND'); return adapter;
  }
  private seat(id:string,token:string):string {
    check(typeof token==='string' && token.length>0,'Authentication required.','UNAUTHORIZED');
    const seat=this.db.prepare('SELECT player_id FROM seats WHERE episode_id=? AND token_hash=?').get(id,digest(token));
    check(seat,'Invalid seat credential.','UNAUTHORIZED'); return seat.player_id as string;
  }
  private projection(row:Row,playerId:string):Omit<Envelope,'observationId'|'decisionToken'> {
    const game=this.adapter(row), state=JSON.parse(row.state), outcome=game.outcome(state);
    const safe=outcome ? {kind:outcome.kind ?? (outcome.success?'win':'loss'),success:outcome.success,score:outcome.score,
      ...(outcome.maxScore!==undefined?{maxScore:outcome.maxScore}:{}),reason:outcome.reason} : null;
    return {episodeId:row.id,playerId,status:row.status,view:game.observe(state,playerId),
      legalActions:row.status==='active'?game.legalActions(state,playerId):[],outcome:safe};
  }
  /** Called inside the event transaction, never from audit reads. A prepared view
   * is evidence of visibility, not a claim that a client actually fetched it. */
  private recordFrame(row:Row,event:{at:string;kind:string;playerId?:string|null;stateHash:string;payload:JsonObject}):void {
    check(event.kind==='truncated'||row.revision<this.limits.maxEventsPerEpisode,'Episode event budget reached; the coordinator can truncate this attempt.','RESOURCE_LIMIT');
    const views:JsonObject={},viewProvenance:JsonObject={};
    for(const playerId of players(JSON.parse(row.options).playerCount)) {
      views[playerId]=this.projection(row,playerId);viewProvenance[playerId]='server-projection';
    }
    const command=event.payload.command;
    const issued=command&&typeof command.observationId==='string' ? this.db.prepare('SELECT payload FROM observations WHERE id=? AND episode_id=? AND player_id=?').get(command.observationId,row.id,event.playerId??''):undefined;
    this.rollouts.record(row.id,{seq:row.revision,at:event.at,kind:event.kind,playerId:event.playerId??null,
      requestId:event.payload.requestId??null,action:command?.action??null,decisionSummary:command?.decisionSummary??null,
      error:event.payload.response?.error??null,stateHash:event.stateHash,
      observed:issued?RolloutStore.safeObservation(JSON.parse(issued.payload as string)):null,
      views,viewProvenance,outcome:this.adapter(row).outcome(JSON.parse(row.state)),status:row.status,coverage:'recorded',evidence:'transactional-server-snapshots',
      ...(event.kind==='elapsed'?{elapsedMs:event.payload.elapsedMs}:{}),
      ...(event.kind==='truncated'?{reason:event.payload.reason}:{}),
    });
  }
  private refreshViews(row:Row,actor?:string):void {
    const game=this.adapter(row);
    for(const id of players(JSON.parse(row.options).playerCount)) {
      const projected=this.projection(row,id);
      const fingerprint=digest(game.decisionContext ? {...projected,view:game.decisionContext(JSON.parse(row.state),id)} : projected);
      const previous=this.db.prepare('SELECT * FROM views WHERE episode_id=? AND player_id=?').get(row.id,id);
      if(!previous || previous.fingerprint!==fingerprint){
        const last=this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM visible_updates WHERE episode_id=? AND player_id=?').get(row.id,id)!;
        this.db.prepare('INSERT INTO visible_updates VALUES(?,?,?,?,?)').run(row.id,id,Number(last.seq)+1,now(),JSON.stringify({view:projected.view,status:row.status}));
      }
      if(!previous || previous.fingerprint!==fingerprint || id===actor)
        this.db.prepare('INSERT INTO views VALUES(?,?,?,?) ON CONFLICT(episode_id,player_id) DO UPDATE SET fingerprint=excluded.fingerprint,decision_token=excluded.decision_token').run(row.id,id,fingerprint,secret());
    }
  }
  /** Lazy materialization of an authoritative wall clock. Even after a restart,
   * elapsed downtime counts. No client can submit its own elapsed duration. */
  private tick(row:Row):void {
    const game=this.adapter(row); if(!game.advanceTime || row.status!=='active')return;
    const clock=this.db.prepare('SELECT last_ms FROM clocks WHERE episode_id=?').get(row.id)!;
    const current=Math.max(this.clock(),Number(clock.last_ms)), elapsedMs=current-Number(clock.last_ms);
    check(Number.isSafeInteger(elapsedMs),'Invalid system clock.','INTERNAL');if(elapsedMs===0)return;
    const previous=JSON.parse(row.state), state=game.advanceTime(previous,elapsedMs);
    this.db.prepare('UPDATE clocks SET last_ms=? WHERE episode_id=?').run(current,row.id);
    if(digest(previous)===digest(state))return;
    row.state=JSON.stringify(state);row.status=game.outcome(state)?'completed':'active';row.revision++;
    this.db.prepare('UPDATE episodes SET state=?,status=?,revision=? WHERE id=?').run(row.state,row.status,row.revision,row.id);
    this.refreshViews(row);
    const at=now(),payload={elapsedMs},stateHash=digest(state);
    this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run(row.id,row.revision,at,null,'elapsed',JSON.stringify(payload),stateHash);
    this.recordFrame(row,{at,kind:'elapsed',stateHash,payload});
  }
  private issue(row:Row,playerId:string,after=0):Envelope {
    const view=this.db.prepare('SELECT decision_token FROM views WHERE episode_id=? AND player_id=?').get(row.id,playerId)!;
    const latest=this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM visible_updates WHERE episode_id=? AND player_id=?').get(row.id,playerId)!;
    check(Number.isSafeInteger(after) && after>=0 && after<=Number(latest.seq),'Invalid own-view update cursor.','INVALID_REQUEST');
    const updates=this.db.prepare('SELECT seq,prepared_at,payload FROM visible_updates WHERE episode_id=? AND player_id=? AND seq>? ORDER BY seq').all(row.id,playerId,after)
      .map(u=>({seq:Number(u.seq),preparedAt:u.prepared_at as string,...JSON.parse(u.payload as string)}));
    const projected={...this.projection(row,playerId),decisionToken:view.decision_token as string,updateCursor:Number(latest.seq),updates};
    const fingerprint=digest(projected);
    const cached=this.db.prepare('SELECT o.payload FROM observation_cache c JOIN observations o ON o.id=c.observation_id WHERE c.episode_id=? AND c.player_id=? AND c.fingerprint=?').get(row.id,playerId,fingerprint);
    if(cached)return JSON.parse(cached.payload as string);
    const count=this.db.prepare('SELECT COUNT(*) AS n FROM observations WHERE episode_id=? AND player_id=?').get(row.id,playerId)!;
    check(Number(count.n)<this.limits.maxObservationsPerSeat,'Seat observation budget reached; the coordinator can truncate this attempt.','RESOURCE_LIMIT');
    const payload:Envelope={...projected,observationId:randomUUID()};
    this.db.prepare('INSERT INTO observations VALUES(?,?,?,?,?)').run(payload.observationId,row.id,playerId,now(),JSON.stringify(payload));
    this.db.prepare('INSERT INTO observation_cache VALUES(?,?,?,?)').run(row.id,playerId,fingerprint,payload.observationId);
    return payload;
  }
  /** Trusted coordinator only. Seed is never accepted by the public HTTP route. */
  create(gameId:string, options:Omit<SetupOptions,'seed'> & {seed?:string}):Creation {
    const game=this.adapters.get(gameId); check(game,'Game not admitted or implemented.','NOT_FOUND');
    exactKeys(options,['playerCount','scenarioId','config','seed']);
    check(game.metadata.players.includes(options.playerCount),'Unsupported player count.','INVALID_CONFIG');
    check(game.metadata.scenarios.some(s=>s.id===options.scenarioId),'Unsupported scenario.','INVALID_CONFIG');
    check(options.seed===undefined || (typeof options.seed==='string' && options.seed.length>0 && options.seed.length<=256),'Invalid seed.','INVALID_CONFIG');
    const setup={...options,seed:options.seed ?? secret()};
    const state=game.setup(setup), id=randomUUID();
    return this.transaction(()=>{
      const count=this.db.prepare("SELECT COUNT(*) AS total,COALESCE(SUM(status='active'),0) AS active FROM episodes").get()!;
      check(Number(count.total)<this.limits.maxEpisodes,'Saved episode limit reached. Existing history is retained; raise the configured budget to accept new episodes.','RESOURCE_LIMIT');
      check(Number(count.active)<this.limits.maxActiveEpisodes,'Active episode limit reached. Finish or truncate an existing attempt.','RESOURCE_LIMIT');
      this.db.prepare('INSERT INTO episodes VALUES(?,?,?,?,?,?,?,?,?)').run(id,gameId,JSON.stringify(setup),JSON.stringify(state),game.outcome(state)?'completed':'active',0,this.build,JSON.stringify(game.metadata),null);
      this.db.prepare('INSERT INTO clocks VALUES(?,?)').run(id,this.clock());
      const seats=players(options.playerCount).map(playerId=>({playerId,token:secret()}));
      for(const seat of seats) this.db.prepare('INSERT INTO seats VALUES(?,?,?)').run(id,seat.playerId,digest(seat.token));
      const row=this.row(id);this.refreshViews(row);
      const at=now(),payload={gameId,options:setup},stateHash=digest(state);
      this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run(id,0,at,null,'created',JSON.stringify(payload),stateHash);
      this.recordFrame(row,{at,kind:'created',stateHash,payload});
      return {episodeId:id,gameId,scenarioId:options.scenarioId,seats};
    },id);
  }
  observe(id:string,token:string,after=0):Envelope {
    return this.transaction(()=>{const playerId=this.seat(id,token),row=this.row(id);this.tick(row); return this.issue(row,playerId,after);},id);
  }
  submit(id:string,token:string,requestId:string,command:Command):{status:number;body:JsonObject} {
    check(typeof requestId==='string' && /^[A-Za-z0-9._:-]{1,100}$/.test(requestId),'A 1–100 character Idempotency-Key is required.','INVALID_REQUEST');
    return this.transaction(()=>{
      const playerId=this.seat(id,token), row=this.row(id), requestHash=digest(command);
      const prior=this.db.prepare('SELECT * FROM commands WHERE episode_id=? AND player_id=? AND request_id=?').get(id,playerId,requestId);
      if(prior) {
        check(prior.request_hash===requestHash,'Idempotency key was used for a different command.','IDEMPOTENCY_CONFLICT');
        return {status:prior.http_status as number,body:JSON.parse(prior.response as string)};
      }
      const count=this.db.prepare('SELECT COUNT(*) AS n FROM commands WHERE episode_id=?').get(id)!;
      check(Number(count.n)<this.limits.maxCommandsPerEpisode,'Episode command budget reached; the coordinator can truncate this attempt.','RESOURCE_LIMIT');
      check(row.revision<this.limits.maxEventsPerEpisode-1,'Episode event budget reached; the coordinator can truncate this attempt.','RESOURCE_LIMIT');
      this.tick(row);
      let status=200, body:JsonObject, stateHash=digest(JSON.parse(row.state)), kind='accepted';
      const receivedAt=now();
      this.db.exec('SAVEPOINT action_attempt');
      try {
        exactKeys(command,['observationId','decisionToken','action','decisionSummary']);
        check(typeof command.observationId==='string' && typeof command.decisionToken==='string' && object(command.action),'Malformed command.','INVALID_REQUEST');
        check(command.decisionSummary===undefined || (typeof command.decisionSummary==='string' && command.decisionSummary.length<=1200),'Decision summary too long.','INVALID_REQUEST');
        const observed=this.db.prepare('SELECT payload FROM observations WHERE id=? AND episode_id=? AND player_id=?').get(command.observationId,id,playerId);
        check(observed,'Observation was not issued to this seat.','STALE_OBSERVATION');
        const current=this.db.prepare('SELECT decision_token FROM views WHERE episode_id=? AND player_id=?').get(id,playerId)!;
        check(JSON.parse(observed.payload as string).decisionToken===command.decisionToken && current.decision_token===command.decisionToken,'Refresh your observation before acting.','STALE_OBSERVATION');
        check(row.status==='active','Episode is already ended.','EPISODE_ENDED');
        const game=this.adapter(row), state=game.step(JSON.parse(row.state),playerId,clone(command.action));
        // Round-trip prohibits non-JSON state; every step must persist/replay identically.
        check(canonical(state)===canonical(JSON.parse(JSON.stringify(state))),'Non-JSON state.','INTERNAL');
        row.state=JSON.stringify(state); row.status=game.outcome(state)?'completed':'active'; stateHash=digest(state);
        this.db.prepare('UPDATE episodes SET state=?,status=? WHERE id=?').run(row.state,row.status,id);
        this.refreshViews(row,playerId);
        body={accepted:true,observation:this.issue(row,playerId,JSON.parse(observed.payload as string).updateCursor??0)};
        this.db.exec('RELEASE action_attempt');
      } catch(error) {
        this.db.exec('ROLLBACK TO action_attempt; RELEASE action_attempt');
        // The JS row may contain an attempted state although SQLite rolled back.
        // Restore it before taking a rejected-action snapshot.
        Object.assign(row,this.row(id));stateHash=digest(JSON.parse(row.state));
        if(!(error instanceof RuleError) && !(error instanceof Error && 'code' in error && typeof error.code==='string' && 'status' in error)) throw error;
        const rule=error as RuleError;
        if(rule.code==='RESOURCE_LIMIT')throw error;
        status=rule.code==='INTERNAL'?500:rule.code==='INVALID_REQUEST'?400:409;
        kind='rejected'; body={accepted:false,error:{code:rule.code,message:rule.message}};
      }
      row.revision++;
      this.db.prepare('UPDATE episodes SET revision=? WHERE id=?').run(row.revision,id);
      const payload={requestId,command,response:body};
      this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run(id,row.revision,receivedAt,playerId,kind,JSON.stringify(payload),stateHash);
      this.db.prepare('INSERT INTO commands VALUES(?,?,?,?,?,?)').run(id,playerId,requestId,requestHash,status,JSON.stringify(body));
      this.recordFrame(row,{at:receivedAt,kind,playerId,stateHash,payload});
      return {status,body};
    },id);
  }
  /** Coordinator budget cancellation is truncation, never an official loss. */
  truncate(id:string,reason:string):void {
    check(typeof reason==='string' && reason.length>0 && reason.length<=200,'Truncation needs a short reason.','INVALID_REQUEST');
    this.transaction(()=>{
      const row=this.row(id);
      // A single terminal marker must remain possible after exhausting a budget.
      if(row.revision<this.limits.maxEventsPerEpisode-1)this.tick(row);
      if(row.status==='completed')return;
      check(row.status==='active','Episode already ended.','EPISODE_ENDED');
      row.status='truncated'; row.revision++;
      this.db.prepare('UPDATE episodes SET status=?,revision=?,end_reason=? WHERE id=?').run(row.status,row.revision,reason,id);
      this.refreshViews(row);
      const at=now(),payload={reason},stateHash=digest(JSON.parse(row.state));
      this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)').run(id,row.revision,at,null,'truncated',JSON.stringify(payload),stateHash);
      this.recordFrame(row,{at,kind:'truncated',stateHash,payload});
    },id,true);
  }
  /** Privileged, only after the episode ends. Never return this to a player tool. */
  audit(id:string):JsonObject {
    const row=this.historicalRow(id); check(row.status!=='active','Audit opens after completion or truncation.','EPISODE_ACTIVE');
    const outcome=this.rollouts.get(id).summary.outcome;
    return {schemaVersion:'coop-bench-audit-v1',episodeId:id,gameId:row.game_id,build:row.build,metadata:JSON.parse(row.metadata),
      options:JSON.parse(row.options),status:row.status,endReason:row.end_reason,finalState:JSON.parse(row.state),outcome,
      events:this.db.prepare('SELECT * FROM events WHERE episode_id=? ORDER BY seq').all(id).map(e=>({...e,payload:JSON.parse(e.payload as string)})),
      issuedObservations:this.db.prepare('SELECT * FROM observations WHERE episode_id=? ORDER BY rowid').all(id).map(o=>({...o,payload:JSON.parse(o.payload as string)}))};
  }
  verifyReplay(id:string):{valid:true;acceptedActions:number;finalStateHash:string} {
    this.row(id); // History is readable across builds; replay is not certified across builds.
    const audit=this.audit(id), game=this.adapters.get(audit.gameId)!;
    let state=game.setup(audit.options), count=0;
    for(const event of audit.events) {
      if(event.kind==='accepted') {state=game.step(state,event.player_id,event.payload.command.action);count++;}
      if(event.kind==='elapsed') {check(game.advanceTime,'Missing system clock handler.','REPLAY_MISMATCH');state=game.advanceTime(state,event.payload.elapsedMs);}
      check(digest(state)===event.state_hash,`Replay diverged at event ${event.seq}.`,'REPLAY_MISMATCH');
    }
    check(digest(state)===digest(audit.finalState),'Final state mismatch.','REPLAY_MISMATCH');
    return {valid:true,acceptedActions:count,finalStateHash:digest(state)};
  }
  exportTraining(id:string):JsonObject {
    const audit=this.audit(id), issued=new Map(audit.issuedObservations.map((o:any)=>[o.id,o.payload]));
    const outcome=audit.outcome as Outcome|null;
    const reward=outcome ? outcome.kind==='score-only' ? outcome.score/(outcome.maxScore??1) : Number(outcome.success) : null;
    return {format:'coop-bench-own-observation-sft-v1',episodeId:id,gameId:audit.gameId,scenarioId:audit.options.scenarioId,
      engineBuild:audit.build,partitionFamily:digest({sourceSeed:audit.options.seed}),
      status:audit.status,terminated:audit.status==='completed',truncated:audit.status==='truncated',
      verifier:audit.metadata.implementation.verifier,
      rewardPolicy:'terminal-team-win-or-normalized-score-v1',terminalTeamReward:reward,
      rows:audit.events.filter((e:any)=>e.kind==='accepted').map((e:any)=>({
        playerId:e.player_id,observed:issued.get(e.payload.command.observationId),action:e.payload.command.action,
        acceptedAt:e.received_at,resultObservation:e.payload.response.observation,
        ...(e.payload.command.decisionSummary?{playerDecisionSummary:e.payload.command.decisionSummary}:{}),
        provenance:'issued-by-server-not-proof-of-client-receipt'
      })),
      notes:['Inputs contain only observations issued to that actor. No seed, other hands, full state, or post-hoc reflection in model inputs.',
        'resultObservation is immediately after this action, not necessarily the next own decision. A trainer must join the next observation for its selected RL transition convention.',
        'terminalTeamReward is an episode label. Truncated episodes have no fabricated losing reward.',
        'Rejected actions remain in the audit, excluded from this SFT export. These are trajectories, not automatically quality-filtered demonstrations.']};
  }
  /** Coordinator-only methods. These read historical evidence without ticking the game. */
  listRollouts(options:{limit?:number;offset?:number;status?:string;gameId?:string}={}):JsonObject {return this.rollouts.list(options);}
  getRollout(id:string):JsonObject {return this.rollouts.get(id);}
  addRolloutAnnotation(id:string,input:{kind:'reflection'|'review';playerId?:string;text:string;source?:string}):JsonObject {
    return this.transaction(()=>this.rollouts.annotate(id,input),id);
  }
  /** A player can only attach their own post-game reflection; seat identity is authoritative. */
  submitReflection(id:string,token:string,text:string):JsonObject {
    return this.transaction(()=>{const playerId=this.seat(id,token);return this.rollouts.annotate(id,{kind:'reflection',text},playerId);},id);
  }
  retention():JsonObject {
    return {policy:'indefinite',automaticDeletion:false,automaticExpiry:false,onCapacity:'reject-new-writes',
      rolloutPayloadBytes:this.totalStorageBytes(),maxRolloutPayloadBytes:this.limits.maxStoredBytesTotal,maxEpisodes:this.limits.maxEpisodes,
      artifacts:this.artifacts.retention(),messages:this.messages.retention(),
      evidenceBoundary:'Server records API traffic and game evidence; complete client transcripts must be uploaded separately. The server cannot recover unavailable private reasoning.'};
  }
  /** Historical artifacts use recorded seat identity, even when engine builds differ. */
  private artifactSeat(id:string,token:string,requireEnded=false):string {
    const playerId=this.seat(id,token),row=this.historicalRow(id);
    if(requireEnded)check(row.status!=='active','Client artifacts can be submitted only after completion or truncation.','EPISODE_ACTIVE');
    return playerId;
  }
  createArtifact(id:string,token:string,requestId:string,input:unknown) {return this.artifacts.create(id,this.artifactSeat(id,token,true),requestId,input);}
  putArtifactChunk(id:string,token:string,artifactId:string,input:unknown) {return this.artifacts.chunk(id,this.artifactSeat(id,token,true),artifactId,input);}
  completeArtifact(id:string,token:string,artifactId:string) {return this.artifacts.complete(id,this.artifactSeat(id,token,true),artifactId);}
  listSeatArtifacts(id:string,token:string) {return {artifacts:this.artifacts.list(id,this.artifactSeat(id,token)),retention:this.artifacts.retention(false)};}
  seatArtifactContent(id:string,token:string,artifactId:string) {return this.artifacts.content(id,artifactId,this.artifactSeat(id,token));}
  listRolloutArtifacts(id:string) {this.historicalRow(id);return {artifacts:this.artifacts.list(id),retention:this.artifacts.retention()};}
  rolloutArtifactContent(id:string,artifactId:string) {this.historicalRow(id);return this.artifacts.content(id,artifactId);}
  /** Private research capture, not a way to speak to other players. No game tick,
   * event, observation, decision token or state hash is written by these methods. */
  appendMessage(id:string,token:string,input:unknown) {
    const playerId=this.artifactSeat(id,token);
    if(object(input)&&typeof input.observationId==='string')check(this.db.prepare('SELECT 1 FROM observations WHERE id=? AND episode_id=? AND player_id=?').get(input.observationId,id,playerId),'observationId must refer to an observation issued to this seat.','INVALID_REQUEST');
    return this.messages.append(id,playerId,input);
  }
  completeMessages(id:string,token:string,input:unknown) {return this.messages.complete(id,this.artifactSeat(id,token,true),input);}
  listSeatMessages(id:string,token:string,after=-1,limit=50) {return this.messages.list(id,this.artifactSeat(id,token),after,limit);}
  listRolloutMessages(id:string,playerId?:string,after=-1,limit=50) {
    check(Number.isSafeInteger(after)&&after>=-1&&Number.isInteger(limit)&&limit>=1&&limit<=100,'Invalid message pagination.','INVALID_REQUEST');
    this.historicalRow(id);if(playerId===undefined)return this.messages.summary(id);
    check(this.db.prepare('SELECT 1 FROM seats WHERE episode_id=? AND player_id=?').get(id,playerId),'Unknown player seat.','NOT_FOUND');
    return this.messages.list(id,playerId,after,limit);
  }
}
