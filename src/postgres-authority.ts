import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { check, clone, exactKeys, object, players, RuleError } from './common.ts';
import type { GameAdapter, JsonObject, Outcome, SetupOptions } from './types.ts';
import { DEFAULT_AUTHORITY_LIMITS, sourceBuild, digest as tokenDigest } from './authority.ts';
import type { AuthorityLimits, Command, Creation, Envelope } from './authority.ts';
import { PostgresStore } from './postgres-store.ts';
import type { EvidenceWrite, PgClient } from './postgres-store.ts';
import { ARTIFACT_CHUNK_SIZE } from './artifact-store.ts';

const stable=(value:any):string=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:object(value)?`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`:JSON.stringify(value);
const hash=(value:any):string=>createHash('sha256').update(typeof value==='string'?value:stable(value)).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const seqKey=(seq:number)=>String(seq).padStart(16,'0');
const seatKey=(seat:string,key:string|number)=>`${seat}/${typeof key==='number'?seqKey(key):key}`;
const provenance='client-supplied-unverified';
const safe=(observation:JsonObject|null|undefined)=>{if(!observation)return null;const {decisionToken,...rest}=observation;return rest;};
interface Seat {tokenHash:string;decisionToken:string;fingerprint:string;cursor:number;}
interface Budget {episodeDeadline:number;key:string|null;windowId:string|null;deadline:number|null;required:string[];mode:'all'|'any'|'official-clock';}
interface Episode extends JsonObject {
  id:string;gameId:string;options:SetupOptions;state:any;status:Envelope['status'];build:string;metadata:JsonObject;
  endReason:string|null;seats:Record<string,Seat>;lastMs:number;budget:Budget|null;commandCount:number;
}
interface Snapshot {id:string;revision:number;data:Episode;}
class RetryCommit extends Error {}

/** Stateless game authority: PostgreSQL version-CAS is the only commit authority.
 * Persistent histories are separate from the bounded current state row. No socket,
 * notification, API process, seat cursor or decision token is a database revision. */
export class PostgresAuthority {
  readonly store:PostgresStore;readonly pool:Pool;readonly adapters:Map<string,GameAdapter>;readonly build:string;
  readonly limits:Readonly<AuthorityLimits>;
  readonly clock=Date.now;
  constructor(connection:string|Pool,adapters:GameAdapter[],build=sourceBuild(),limits:Partial<AuthorityLimits>={}) {
    this.store=new PostgresStore(connection);this.pool=this.store.pool;this.adapters=new Map(adapters.map(a=>[a.metadata.id,a]));this.build=build;
    this.limits=Object.freeze({...DEFAULT_AUTHORITY_LIMITS,...limits});
    for(const value of Object.values(this.limits))check(Number.isSafeInteger(value)&&value>0,'Limits must be positive safe integers.','INVALID_CONFIG');
  }
  ready(){return this.store.ready();}
  close(){return this.store.close();}
  async withTransaction<T>(run:(client:PoolClient)=>Promise<T>):Promise<T>{await this.ready();return this.store.transaction(run);}
  private async row(id:string,client:PgClient=this.pool,historical=false):Promise<Snapshot> {
    await this.ready();const row=await this.store.row(id,client);
    if(!historical)check(row.data.build===this.build,'Episode engine build differs; use the pinned build.','BUILD_MISMATCH');
    return row as Snapshot;
  }
  private game(row:Episode):GameAdapter {const game=this.adapters.get(row.gameId);check(game,'Game is not installed.','NOT_FOUND');return game;}
  private seat(row:Episode,token:string):string {
    check(typeof token==='string'&&token.length>0,'Authentication required.','UNAUTHORIZED');
    const digest=tokenDigest(token),seat=Object.keys(row.seats).find(p=>row.seats[p].tokenHash===digest);
    check(seat,'Invalid seat credential.','UNAUTHORIZED');return seat;
  }
  private projection(row:Episode,playerId:string):Omit<Envelope,'decisionToken'|'observationId'> {
    const game=this.game(row),outcome=row.status==='truncated'?null:game.outcome(row.state),budget=row.budget;
    return {episodeId:row.id,playerId,status:row.status,view:game.observe(row.state,playerId),
      legalActions:row.status==='active'?game.legalActions(row.state,playerId):[],
      outcome:outcome?{kind:outcome.kind??(outcome.success?'win':'loss'),success:outcome.success,score:outcome.score,
        ...(outcome.maxScore!==undefined?{maxScore:outcome.maxScore}:{}),reason:outcome.reason}:null,
      ...(budget?{control:{windowId:budget.windowId,deadlineAt:budget.deadline,episodeDeadlineAt:budget.episodeDeadline,
        required:row.status==='active'&&budget.required.includes(playerId),mode:budget.mode,endReason:row.endReason}}:{})};
  }
  private syncWindow(row:Episode,time:number):void {
    const budget=row.budget;if(!budget)return;
    const window=row.status==='active'?this.game(row).decisionWindow?.(row.state):null;
    if(!window){Object.assign(budget,{key:null,windowId:null,deadline:null,required:[],mode:'official-clock'});return;}
    check(typeof window.key==='string'&&window.players.every(p=>row.seats[p]),'Invalid adapter decision window.','INTERNAL');
    if(budget.key!==window.key){budget.key=window.key;budget.windowId=randomUUID();budget.deadline=time+60000;}
    budget.required=[...window.players];budget.mode=window.mode;
  }
  private refresh(row:Episode,time:number,actor?:string):EvidenceWrite[] {
    const writes:EvidenceWrite[]=[],game=this.game(row);
    for(const [playerId,seat] of Object.entries(row.seats)) {
      const projected=this.projection(row,playerId);
      const fingerprint=hash(game.decisionContext?{...projected,view:game.decisionContext(row.state,playerId)}:projected);
      if(fingerprint!==seat.fingerprint){seat.cursor++;writes.push({kind:'visible',key:seatKey(playerId,seat.cursor),value:{seq:seat.cursor,preparedAt:new Date(time).toISOString(),view:projected.view,status:row.status}});}
      if(fingerprint!==seat.fingerprint||actor===playerId)seat.decisionToken=secret();
      seat.fingerprint=fingerprint;
    }
    return writes;
  }
  private async issue(row:Episode,playerId:string,after:number,client:PoolClient,limit=500):Promise<Envelope> {
    const seat=row.seats[playerId];check(Number.isSafeInteger(after)&&after>=0&&after<=seat.cursor,'Invalid own-view cursor.','INVALID_REQUEST');
    check(Number.isInteger(limit)&&limit>=1&&limit<=500,'Observation page limit must be 1–500.','INVALID_REQUEST');
    // A page advances only to the last delivered update. The head is separate.
    const updates=(await client.query("SELECT value FROM coop_pg_evidence WHERE episode_id=$1 AND kind='visible' AND key>$2 AND key<=$3 ORDER BY key LIMIT $4",[row.id,seatKey(playerId,after),seatKey(playerId,seat.cursor),limit+1])).rows.map(r=>r.value);
    const hasMore=updates.length>limit;if(hasMore)updates.pop();
    const next=updates.at(-1)?.seq??after;
    const projected={...this.projection(row,playerId),decisionToken:seat.decisionToken,updateCursor:next,nextCursor:next,hasMore,updates,
      ...(hasMore?{hasMoreUpdates:true,headCursor:seat.cursor}:{})};
    const fingerprint=hash(projected),prior=await this.store.evidence(row.id,'observation-cache',seatKey(playerId,fingerprint),client);
    if(prior)return prior.payload as Envelope;
    // Lock only this observation counter; repeated polling does not mutate a game revision.
    await client.query('INSERT INTO coop_pg_streams(episode_id,player_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[row.id,playerId]);
    const stream=(await client.query('SELECT data FROM coop_pg_streams WHERE episode_id=$1 AND player_id=$2 FOR UPDATE',[row.id,playerId])).rows[0].data;
    const raced=await this.store.evidence(row.id,'observation-cache',seatKey(playerId,fingerprint),client);if(raced)return raced.payload as Envelope;
    check((stream.observations??0)<this.limits.maxObservationsPerSeat,'Seat observation budget reached.','RESOURCE_LIMIT');
    const payload={...projected,observationId:randomUUID()} as Envelope;
    await client.query('UPDATE coop_pg_streams SET data=$3 WHERE episode_id=$1 AND player_id=$2',[row.id,playerId,{...stream,observations:(stream.observations??0)+1}]);
    await this.store.writeEvidence(client,row.id,[{kind:'observation',key:payload.observationId,value:{id:payload.observationId,episode_id:row.id,player_id:playerId,issued_at:new Date(await this.store.now(client)).toISOString(),payload}},
      {kind:'observation-cache',key:seatKey(playerId,fingerprint),value:{payload}}],this.limits.maxStoredBytesPerEpisode,this.limits.maxStoredBytesTotal);
    return payload;
  }
  private async frame(row:Episode,revision:number,event:JsonObject,client:PoolClient):Promise<JsonObject> {
    const views:JsonObject={},viewProvenance:JsonObject={};
    for(const playerId of Object.keys(row.seats)){views[playerId]=this.projection(row,playerId);viewProvenance[playerId]='server-projection';}
    const command=event.payload.command,issued=typeof command?.observationId==='string'?await this.store.evidence(row.id,'observation',command.observationId,client):null;
    return {seq:revision,at:event.received_at,kind:event.kind,playerId:event.player_id??null,requestId:event.payload.requestId??null,
      action:command?.action??null,decisionSummary:command?.decisionSummary??null,error:event.payload.response?.error??null,
      stateHash:event.state_hash,observed:issued?.player_id===event.player_id?safe(issued.payload):null,views,viewProvenance,
      outcome:row.status==='truncated'?null:this.game(row).outcome(row.state),status:row.status,coverage:'recorded',evidence:'transactional-server-snapshots',
      ...(event.kind==='elapsed'?{elapsedMs:event.payload.elapsedMs}:{}),...(event.kind==='truncated'?{reason:event.payload.reason}:{})};
  }
  private async commit(base:Snapshot,next:Episode,kind:string,payload:JsonObject,at:number,actor?:string,receipt?:{requestId:string;hash:string;status:number;body:JsonObject;after?:number},deadline:number|null=null):Promise<JsonObject|undefined> {
    return this.store.transaction(async client=>{
      if(receipt){const prior=await this.store.evidence(next.id,'receipt',seatKey(actor!,receipt.requestId),client);
        if(prior){check(prior.requestHash===receipt.hash,'Idempotency key was used for a different command.','IDEMPOTENCY_CONFLICT');return {status:prior.status,body:prior.body};}}
      const revision=base.revision+1,writes=this.refresh(next,at,kind==='accepted'?actor:undefined);
      const priorSummary=base.data.summary??{createdAt:null,eventCount:base.revision+1,actionCount:0,rejectedCount:0};
      next.summary={...priorSummary,updatedAt:new Date(at).toISOString(),eventCount:priorSummary.eventCount+1,
        actionCount:priorSummary.actionCount+Number(kind==='accepted'),rejectedCount:priorSummary.rejectedCount+Number(kind==='rejected'),
        outcome:next.status==='completed'?this.game(next).outcome(next.state):null};
      check(kind==='truncated'||revision<this.limits.maxEventsPerEpisode,'Episode event budget reached.','RESOURCE_LIMIT');
      check(Buffer.byteLength(JSON.stringify(next))<=1024*1024,'Current state exceeds 1 MiB.','RESOURCE_LIMIT');
      const updated=await client.query(`UPDATE coop_pg_episodes SET revision=$3,data=$4,updated_at=clock_timestamp()
        WHERE id=$1 AND revision=$2 AND ($5::bigint IS NULL OR floor(extract(epoch FROM clock_timestamp())*1000)<$5) RETURNING id`,[base.id,base.revision,revision,next,deadline]);
      if(!updated.rowCount)throw new RetryCommit();
      // UPDATE may have waited for a reader's row lock without a tuple change.
      // Recheck the authoritative acceptance instant after acquiring the lock.
      if(deadline!==null&&await this.store.now(client)>=deadline)throw new RetryCommit();
      const stateGrowth=Math.max(0,Buffer.byteLength(JSON.stringify(next))-Buffer.byteLength(JSON.stringify(base.data)));
      if(stateGrowth){const changed=await client.query('UPDATE coop_pg_episodes SET stored_bytes=stored_bytes+$2 WHERE id=$1 AND ($4 OR stored_bytes+$2<=$3) RETURNING id',[next.id,stateGrowth,this.limits.maxStoredBytesPerEpisode,kind==='truncated']);
        check(changed.rowCount===1,'Episode storage budget reached.','RESOURCE_LIMIT');
        if(kind==='truncated')await client.query("UPDATE coop_pg_usage SET bytes=bytes+$1 WHERE category='game'",[stateGrowth]);else await this.store.reserve(client,'game',stateGrowth,this.limits.maxStoredBytesTotal);}
      await this.store.writeEvidence(client,next.id,writes,this.limits.maxStoredBytesPerEpisode,this.limits.maxStoredBytesTotal,kind==='truncated');
      if(receipt?.after!==undefined)receipt.body={accepted:true,observation:await this.issue(next,actor!,receipt.after,client)};
      if(receipt)payload={...payload,response:receipt.body};
      const event={episode_id:next.id,seq:revision,received_at:new Date(at).toISOString(),player_id:actor??null,kind,payload,state_hash:hash(next.state)};
      const evidence:EvidenceWrite[]=[{kind:'event',key:seqKey(revision),value:event},{kind:'frame',key:seqKey(revision),value:await this.frame(next,revision,event,client)}];
      if(receipt)evidence.push({kind:'receipt',key:seatKey(actor!,receipt.requestId),value:{requestHash:receipt.hash,status:receipt.status,body:receipt.body}});
      await this.store.writeEvidence(client,next.id,evidence,this.limits.maxStoredBytesPerEpisode,this.limits.maxStoredBytesTotal,kind==='truncated');
      await client.query("SELECT pg_notify('coop_game_updates',$1)",[next.id]);
      return receipt?{status:receipt.status,body:receipt.body}:undefined;
    });
  }
  private async retry<T>(operation:()=>Promise<T>):Promise<T> {
    for(let attempt=0;attempt<24;attempt++){try{return await operation();}catch(error){if(!(error instanceof RetryCommit))throw error;}}
    throw new RuleError('BUSY','Concurrent activity prevented this commit; retry with the same request ID.');
  }
  async create(gameId:string,options:Omit<SetupOptions,'seed'>&{seed?:string},client?:PoolClient):Promise<Creation> {
    await this.ready();return client?this.createInTransaction(client,gameId,options):this.store.transaction(c=>this.createInTransaction(c,gameId,options));
  }
  async createSession(gameId:string,options:Omit<SetupOptions,'seed'>&{seed?:string}):Promise<Creation> {
    await this.ready();return this.store.transaction(client=>this.createInTransaction(client,gameId,options,true));
  }
  async createInTransaction(client:PoolClient,gameId:string,options:Omit<SetupOptions,'seed'>&{seed?:string},sessionBudget=false):Promise<Creation> {
    const game=this.adapters.get(gameId);check(game,'Game not admitted or implemented.','NOT_FOUND');exactKeys(options,['playerCount','scenarioId','config','seed']);
    check(game.metadata.players.includes(options.playerCount),'Unsupported player count.','INVALID_CONFIG');
    check(game.metadata.scenarios.some(s=>s.id===options.scenarioId),'Unsupported scenario.','INVALID_CONFIG');
    check(options.seed===undefined||(typeof options.seed==='string'&&options.seed.length>0&&options.seed.length<=256),'Invalid seed.','INVALID_CONFIG');
    // Creation quotas serialize with one tiny quota row; gameplay uses per-episode CAS.
    await client.query("SELECT category FROM coop_pg_usage WHERE category='game' FOR UPDATE");
    const count=(await client.query("SELECT count(*) total,count(*) FILTER(WHERE data->>'status'='active') active FROM coop_pg_episodes")).rows[0];
    check(Number(count.total)<this.limits.maxEpisodes&&Number(count.active)<this.limits.maxActiveEpisodes,'Episode capacity reached; existing history is retained.','RESOURCE_LIMIT');
    const setup={...options,seed:options.seed??secret()},state=game.setup(setup),id=randomUUID(),time=await this.store.now(client);
    const seats=players(options.playerCount).map(playerId=>({playerId,token:secret()}));
    const row:Episode={id,gameId,options:setup,state,status:game.outcome(state)?'completed':'active',build:this.build,metadata:game.metadata,endReason:null,
      seats:Object.fromEntries(seats.map(s=>[s.playerId,{tokenHash:tokenDigest(s.token),decisionToken:secret(),fingerprint:'',cursor:0}])),lastMs:time,budget:null,commandCount:0};
    row.summary={createdAt:new Date(time).toISOString(),updatedAt:new Date(time).toISOString(),eventCount:1,actionCount:0,rejectedCount:0,outcome:game.outcome(state)};
    if(sessionBudget){check(game.decisionWindow,'Adapter has no required-window policy.','INVALID_CONFIG');row.budget={episodeDeadline:time+3600000,key:null,windowId:null,deadline:null,required:[],mode:'official-clock'};this.syncWindow(row,time);}
    const writes=this.refresh(row,time);
    const initialBytes=Buffer.byteLength(JSON.stringify(row))+128;
    check(initialBytes<=Math.min(1024*1024,this.limits.maxStoredBytesPerEpisode),'Initial state exceeds storage budget.','RESOURCE_LIMIT');
    await this.store.reserve(client,'game',initialBytes,this.limits.maxStoredBytesTotal);
    await client.query('INSERT INTO coop_pg_episodes(id,revision,data,stored_bytes) VALUES($1,0,$2,$3)',[id,row,initialBytes]);
    const event={episode_id:id,seq:0,received_at:new Date(time).toISOString(),player_id:null,kind:'created',payload:{gameId,options:setup,...(sessionBudget?{sessionBudget:true}:{})},state_hash:hash(state)};
    writes.push({kind:'event',key:seqKey(0),value:event},{kind:'frame',key:seqKey(0),value:await this.frame(row,0,event,client)});
    await this.store.writeEvidence(client,id,writes,this.limits.maxStoredBytesPerEpisode,this.limits.maxStoredBytesTotal);
    return {episodeId:id,gameId,scenarioId:options.scenarioId,seats};
  }
  private async materialize(id:string):Promise<Snapshot> {
    return this.retry(async()=>{
      const base=await this.row(id),row=base.data;if(row.status!=='active')return base;
      const next=clone(row),time=await this.store.now(),budget=next.budget,game=this.game(next);
      const cap=budget?Math.min(budget.episodeDeadline,budget.deadline??Infinity):Infinity;
      if(game.advanceTime){
        const current=Math.max(next.lastMs,Math.min(time,cap)),elapsedMs=current-next.lastMs;
        if(elapsedMs>0){next.state=game.advanceTime(clone(next.state),elapsedMs);next.lastMs=current;
          if(hash(next.state)!==hash(row.state)){next.status=game.outcome(next.state)?'completed':'active';this.syncWindow(next,time);await this.commit(base,next,'elapsed',{elapsedMs},time);
            // Do not chase wall time recursively: every DB round trip itself consumes
            // time and a real-time game could otherwise make observe never return.
            return next.status==='active'&&time>=cap?this.materialize(id):this.row(id);}
        }
      }
      if(budget&&time>=cap){next.status='truncated';next.endReason=budget.deadline!==null&&budget.deadline<=budget.episodeDeadline?'decision_timeout':'episode_timeout';
        const windowId=budget.windowId;this.syncWindow(next,time);await this.commit(base,next,'truncated',{reason:next.endReason,windowId,deadlineAt:cap},time);return this.row(id);}
      return base;
    });
  }
  async observe(id:string,token:string,after=0,limit=500):Promise<Envelope> {
    const initial=await this.row(id);this.seat(initial.data,token);
    await this.materialize(id);
    return this.store.transaction(async client=>{
      // Snapshot + history are bounded by this committed seat cursor, even if a later commit races.
      await client.query('SELECT id FROM coop_pg_episodes WHERE id=$1 FOR UPDATE',[id]);
      const row=await this.row(id,client),seat=this.seat(row.data,token);return this.issue(row.data,seat,after,client,limit);
    });
  }
  async submit(id:string,token:string,requestId:string,command:Command):Promise<{status:number;body:JsonObject}> {
    check(typeof requestId==='string'&&/^[A-Za-z0-9._:-]{1,100}$/.test(requestId),'A 1–100 character Idempotency-Key is required.','INVALID_REQUEST');
    const requestHash=hash(command);
    return this.retry(async()=>{
      const authenticated=await this.row(id),playerId=this.seat(authenticated.data,token);
      const prior=await this.store.evidence(id,'receipt',seatKey(playerId,requestId));
      if(prior){check(prior.requestHash===requestHash,'Idempotency key was used for a different command.','IDEMPOTENCY_CONFLICT');return {status:prior.status,body:prior.body};}
      const base=await this.materialize(id),next=clone(base.data);this.seat(next,token);
      check(next.commandCount<this.limits.maxCommandsPerEpisode,'Episode command budget reached.','RESOURCE_LIMIT');
      const time=await this.store.now();let kind='accepted',status=200,body:JsonObject={accepted:true},after:number|undefined;
      try {
        exactKeys(command,['observationId','decisionToken','action','decisionSummary']);
        check(typeof command.observationId==='string'&&typeof command.decisionToken==='string'&&object(command.action),'Malformed command.','INVALID_REQUEST');
        check(command.decisionSummary===undefined||(typeof command.decisionSummary==='string'&&command.decisionSummary.length<=1200),'Decision summary too long.','INVALID_REQUEST');
        const issued=await this.store.evidence(id,'observation',command.observationId);
        check(issued?.player_id===playerId,'Observation was not issued to this seat.','STALE_OBSERVATION');
        check(!issued.payload.hasMore,'Fetch remaining observation pages before deciding.','HISTORY_INCOMPLETE');
        check(issued.payload.decisionToken===command.decisionToken&&next.seats[playerId].decisionToken===command.decisionToken,'Refresh your observation before acting.','STALE_OBSERVATION');
        check(next.status==='active','Episode is already ended.','EPISODE_ENDED');
        const game=this.game(next);
        // A paused/briefing clock must restart at the action which starts play;
        // time spent in briefing must not be charged to the official timer.
        if(game.advanceTime&&hash(game.advanceTime(clone(next.state),Math.max(0,time-next.lastMs)))===hash(next.state))next.lastMs=time;
        const state=game.step(clone(next.state),playerId,clone(command.action));
        check(stable(state)===stable(JSON.parse(JSON.stringify(state))),'Non-JSON state.','INTERNAL');
        next.state=state;next.status=game.outcome(state)?'completed':'active';this.syncWindow(next,time);after=issued.payload.updateCursor??0;
      }catch(error){
        if(!(error instanceof RuleError)&&!(error instanceof Error&&'code' in error&&'status' in error))throw error;
        const rule=error as RuleError;if(rule.code==='RESOURCE_LIMIT')throw error;
        Object.assign(next,clone(base.data));kind='rejected';status=rule.code==='INVALID_REQUEST'?400:rule.code==='INTERNAL'?500:409;
        body={accepted:false,error:{code:rule.code,message:rule.message}};
      }
      next.commandCount++;
      const oldBudget=base.data.budget,deadline=kind==='accepted'&&oldBudget?Math.min(oldBudget.episodeDeadline,oldBudget.deadline??Infinity):null;
      return (await this.commit(base,next,kind,{requestId,command},time,playerId,{requestId,hash:requestHash,status,body,after},deadline)) as {status:number;body:JsonObject};
    });
  }
  async enableSessionBudget(id:string,client?:PoolClient):Promise<void> {
    if(client){
      const base=await this.row(id,client),next=clone(base.data);if(next.budget)return;
      check(this.game(next).decisionWindow,'Adapter has no required-window policy.','INVALID_CONFIG');
      const time=await this.store.now(client);next.budget={episodeDeadline:time+3600000,key:null,windowId:null,deadline:null,required:[],mode:'official-clock'};this.syncWindow(next,time);
      const writes=this.refresh(next,time),revision=base.revision+1;
      next.summary={...next.summary,updatedAt:new Date(time).toISOString(),eventCount:(next.summary?.eventCount??base.revision+1)+1};
      const changed=await client.query('UPDATE coop_pg_episodes SET revision=$3,data=$4 WHERE id=$1 AND revision=$2 RETURNING id',[id,base.revision,revision,next]);check(changed.rowCount===1,'Concurrent session start.','CONFLICT');
      const event={episode_id:id,seq:revision,received_at:new Date(time).toISOString(),player_id:null,kind:'session_started',payload:{policy:'required-window-v1',decisionMs:60000,episodeMs:3600000,openedAt:time},state_hash:hash(next.state)};
      writes.push({kind:'event',key:seqKey(revision),value:event},{kind:'frame',key:seqKey(revision),value:await this.frame(next,revision,event,client)});
      await this.store.writeEvidence(client,id,writes,this.limits.maxStoredBytesPerEpisode,this.limits.maxStoredBytesTotal);return;
    }
    await this.retry(async()=>{
      const base=await this.row(id),next=clone(base.data);if(next.budget)return;
      check(this.game(next).decisionWindow,'Adapter has no required-window policy.','INVALID_CONFIG');const time=await this.store.now();
      next.budget={episodeDeadline:time+3600000,key:null,windowId:null,deadline:null,required:[],mode:'official-clock'};this.syncWindow(next,time);
      await this.commit(base,next,'session_started',{policy:'required-window-v1',decisionMs:60000,episodeMs:3600000,openedAt:time},time);
    });
  }
  async advanceSessions():Promise<void> {
    await this.ready();const rows=(await this.pool.query("SELECT id FROM coop_pg_episodes WHERE data->>'status'='active' AND data->>'build'=$1 AND data->'budget'<>'null'::jsonb",[this.build])).rows;
    for(const row of rows)try{await this.materialize(row.id);}catch(error){if(error instanceof RuleError&&error.code==='RESOURCE_LIMIT')await this.truncate(row.id,'resource_limit');else throw error;}
  }
  async seatCursor(id:string,token:string):Promise<number>{const row=(await this.row(id)).data;return row.seats[this.seat(row,token)].cursor;}
  async episodeStatus(id:string,client:PgClient=this.pool):Promise<Envelope['status']>{return (await this.row(id,client,true)).data.status;}
  async episodeRules(id:string,token:string):Promise<JsonObject>{const row=(await this.row(id)).data,seat=this.seat(row,token);return {gameId:row.gameId,scenarioId:row.options.scenarioId,metadata:row.metadata,rulesSummary:row.metadata.rulesSummary,legalActions:row.status==='active'?this.game(row).legalActions(row.state,seat):[]};}
  async bindSeatTokenHash(id:string,playerId:string,tokenHash:string,client:PoolClient):Promise<void> {
    check(typeof tokenHash==='string'&&/^[a-f0-9]{64}$/.test(tokenHash),'Invalid seat token hash.','INVALID_REQUEST');
    const row=(await this.row(id,client)).data;check(row.seats[playerId],'Unknown player seat.','NOT_FOUND');
    row.seats[playerId].tokenHash=tokenHash;
    await client.query('UPDATE coop_pg_episodes SET data=$2 WHERE id=$1',[id,row]);
  }
  async truncate(id:string,reason:string):Promise<void> {
    check(typeof reason==='string'&&reason.length>0&&reason.length<=200,'Truncation needs a short reason.','INVALID_REQUEST');
    await this.retry(async()=>{const base=await this.row(id),next=clone(base.data);if(next.status!=='active')return;next.status='truncated';next.endReason=reason;const time=await this.store.now();this.syncWindow(next,time);await this.commit(base,next,'truncated',{reason},time);});
  }
  async audit(id:string):Promise<JsonObject> {
    const row=(await this.row(id,this.pool,true)).data;check(row.status!=='active','Audit opens after completion or truncation.','EPISODE_ACTIVE');
    const rollout=await this.getRollout(id);
    return {schemaVersion:'coop-bench-audit-v1',episodeId:id,gameId:row.gameId,build:row.build,metadata:row.metadata,options:row.options,status:row.status,endReason:row.endReason,
      finalState:row.state,outcome:rollout.summary.outcome,events:await this.store.records(id,'event'),issuedObservations:await this.store.records(id,'observation')};
  }
  async verifyReplay(id:string):Promise<{valid:true;acceptedActions:number;finalStateHash:string}> {
    await this.row(id);const audit=await this.audit(id),game=this.adapters.get(audit.gameId)!;let state=game.setup(audit.options),count=0;
    for(const event of audit.events){if(event.kind==='accepted'){state=game.step(state,event.player_id,event.payload.command.action);count++;}
      if(event.kind==='elapsed'){check(game.advanceTime,'Missing official clock handler.','REPLAY_MISMATCH');state=game.advanceTime(state,event.payload.elapsedMs);}
      check(hash(state)===event.state_hash,`Replay diverged at event ${event.seq}.`,'REPLAY_MISMATCH');}
    check(hash(state)===hash(audit.finalState),'Final state mismatch.','REPLAY_MISMATCH');return {valid:true,acceptedActions:count,finalStateHash:hash(state)};
  }
  async exportTraining(id:string):Promise<JsonObject> {
    const audit=await this.audit(id),issued=new Map<string,any>(audit.issuedObservations.map((o:any)=>[o.id,o.payload])),outcome=audit.outcome as Outcome|null;
    return {format:'coop-bench-own-observation-sft-v1',episodeId:id,gameId:audit.gameId,scenarioId:audit.options.scenarioId,engineBuild:audit.build,
      partitionFamily:hash({sourceSeed:audit.options.seed}),status:audit.status,terminated:audit.status==='completed',truncated:audit.status==='truncated',verifier:audit.metadata.implementation.verifier,
      rewardPolicy:'terminal-team-win-or-normalized-score-v1',terminalTeamReward:outcome?(outcome.kind==='score-only'?outcome.score/(outcome.maxScore??1):Number(outcome.success)):null,
      rows:audit.events.filter((e:any)=>e.kind==='accepted').map((e:any)=>({playerId:e.player_id,observed:issued.get(e.payload.command.observationId),action:e.payload.command.action,
        acceptedAt:e.received_at,resultObservation:e.payload.response.observation,...(e.payload.command.decisionSummary?{playerDecisionSummary:e.payload.command.decisionSummary}:{}),provenance:'issued-by-server-not-proof-of-client-receipt'})),
      notes:['Player inputs are limited to observations issued to that seat.','Client reasoning must be uploaded separately; unavailable reasoning is never reconstructed.','Truncated episodes have no fabricated losing reward.']};
  }
  async getRollout(id:string):Promise<JsonObject> {
    const row=(await this.row(id,this.pool,true)).data,frames=await this.store.records(id,'frame'),annotations=await this.store.records(id,'annotation');
    const terminal=[...frames].reverse().find(f=>f.status==='completed'),outcome=row.status==='completed'?terminal?.outcome??null:null;
    return {schemaVersion:'coop-bench-rollout-v1',summary:{episodeId:id,gameId:row.gameId,gameName:row.metadata.name,scenarioId:row.options.scenarioId,playerCount:row.options.playerCount,
      status:row.status,createdAt:frames[0]?.at??null,updatedAt:[...frames.map(f=>f.at),...annotations.map(a=>a.createdAt)].sort().at(-1)??null,eventCount:frames.length,
      actionCount:frames.filter(f=>f.kind==='accepted').length,rejectedCount:frames.filter(f=>f.kind==='rejected').length,outcome,outcomeDetailsAvailable:outcome?.details!==undefined,
      build:row.build,compatibleBuild:row.build===this.build,coverage:'recorded'},metadata:row.metadata,players:Object.keys(row.seats),frames,annotations,endReason:row.endReason,
      evidenceNotes:['Server projections show allowed visibility, not proof of client receipt.','Model messages and reasoning are separately uploaded client evidence.','Historical records remain readable across builds; verified replay requires the pinned build.']};
  }
  async listRollouts(options:{limit?:number;offset?:number;status?:string;gameId?:string}={}):Promise<JsonObject> {
    await this.ready();const {limit=50,offset=0,status,gameId}=options;
    check(Number.isInteger(limit)&&limit>=1&&limit<=200&&Number.isSafeInteger(offset)&&offset>=0,'Invalid rollout pagination.','INVALID_REQUEST');
    check(status===undefined||['active','completed','truncated'].includes(status),'Unknown rollout status.','INVALID_REQUEST');
    const where="WHERE ($1::text IS NULL OR data->>'status'=$1) AND ($2::text IS NULL OR data->>'gameId'=$2)";
    // Polling the catalogue must never fetch cards, frames or model transcripts.
    // These small counters/outcomes commit atomically with the corresponding event.
    const rows=(await this.pool.query(`SELECT id,data->>'gameId' game_id,data->'metadata'->>'name' game_name,
      data->'options'->>'scenarioId' scenario_id,data->'options'->>'playerCount' player_count,
      data->>'status' status,data->>'build' build,data->'summary' summary
      FROM coop_pg_episodes ${where} ORDER BY created_at DESC,id LIMIT $3 OFFSET $4`,[status??null,gameId??null,limit,offset])).rows;
    const total=Number((await this.pool.query(`SELECT count(*) n FROM coop_pg_episodes ${where}`,[status??null,gameId??null])).rows[0].n);
    const items=rows.map(row=>{const summary=row.summary??{};return {episodeId:row.id,gameId:row.game_id,gameName:row.game_name,scenarioId:row.scenario_id,
      playerCount:Number(row.player_count),status:row.status,createdAt:summary.createdAt??null,updatedAt:summary.updatedAt??null,
      eventCount:summary.eventCount??0,actionCount:summary.actionCount??0,rejectedCount:summary.rejectedCount??0,outcome:summary.outcome??null,
      outcomeDetailsAvailable:summary.outcome?.details!==undefined,build:row.build,compatibleBuild:row.build===this.build,coverage:'recorded'};});return {items,total,limit,offset};
  }
  async addRolloutAnnotation(id:string,input:{kind:'reflection'|'review';playerId?:string;text:string;source?:string},seatPlayer?:string):Promise<JsonObject> {
    const row=(await this.row(id,this.pool,true)).data;check(object(input),'Invalid annotation.','INVALID_REQUEST');exactKeys(input,['kind','playerId','text','source']);
    check(['reflection','review'].includes(input.kind)&&typeof input.text==='string'&&input.text.trim().length>0&&input.text.length<=20000,'Invalid annotation.','INVALID_REQUEST');
    check(input.playerId===undefined||Boolean(row.seats[input.playerId]),'Unknown player.','INVALID_REQUEST');check(input.source===undefined||(typeof input.source==='string'&&input.source.length<=200),'Invalid source label.','INVALID_REQUEST');
    if(input.kind==='reflection')check(row.status!=='active','Reflection opens after completion or truncation.','EPISODE_ACTIVE');
    return this.store.transaction(async client=>{
      await client.query('SELECT id FROM coop_pg_episodes WHERE id=$1 FOR UPDATE',[id]);const existing=await this.store.records(id,'annotation',client);
      check(existing.length<this.limits.maxAnnotationsPerEpisode&&existing.reduce((n,a)=>n+Buffer.byteLength(a.text),0)+Buffer.byteLength(input.text)<=this.limits.maxAnnotationBytesPerEpisode,'Annotation capacity reached.','RESOURCE_LIMIT');
      if(seatPlayer)check(existing.filter(a=>a.playerId===seatPlayer&&a.source==='seat').length<this.limits.maxAnnotationsPerSeat,'Seat reflection limit reached.','RESOURCE_LIMIT');
      const annotation={id:randomUUID(),kind:input.kind,playerId:seatPlayer??input.playerId??null,text:input.text.trim(),source:seatPlayer?'seat':input.source?`coordinator:${input.source}`:'coordinator',createdAt:new Date(await this.store.now(client)).toISOString()};
      await this.store.writeEvidence(client,id,[{kind:'annotation',key:annotation.id,value:annotation}],this.limits.maxStoredBytesPerEpisode,this.limits.maxStoredBytesTotal);return annotation;
    });
  }
  async submitReflection(id:string,token:string,text:string){const row=(await this.row(id,this.pool,true)).data;return this.addRolloutAnnotation(id,{kind:'reflection',text},this.seat(row,token));}
  async retention():Promise<JsonObject> {
    await this.ready();const usage=Object.fromEntries((await this.pool.query('SELECT category,bytes FROM coop_pg_usage')).rows.map(r=>[r.category,Number(r.bytes)]));
    return {policy:'indefinite',automaticDeletion:false,automaticExpiry:false,onCapacity:'reject-new-writes',rolloutPayloadBytes:usage.game,maxRolloutPayloadBytes:this.limits.maxStoredBytesTotal,maxEpisodes:this.limits.maxEpisodes,
      artifacts:{...this.privateRetention(),reservedBytes:usage.artifacts,chunkSize:ARTIFACT_CHUNK_SIZE,maxArtifactBytes:this.limits.maxArtifactBytes,maxArtifactsPerSeat:this.limits.maxArtifactsPerSeat,maxArtifactStoredBytesTotal:this.limits.maxArtifactStoredBytesTotal},
      messages:{...this.privateRetention(),storedBytes:usage.messages,maxMessageBytes:this.limits.maxMessageBytes,maxMessagesPerSeat:this.limits.maxMessagesPerSeat,maxMessageStoredBytesTotal:this.limits.maxMessageStoredBytesTotal},
      evidenceBoundary:'Server game events are authoritative. Uploaded provider messages and reasoning are client supplied; unavailable private reasoning cannot be recovered.'};
  }
  private privateRetention(){return {policy:'indefinite',automaticDeletion:false,automaticExpiry:false,onCapacity:'reject-new-writes',provenance,visibility:'Uploading seat and authorized auditors only.'};}

  // Private evidence methods below never change a game revision, decision token or public cursor.
  private validateJson(value:unknown):void {
    const pending:[unknown,number][]=[[value,0]];let count=0;
    while(pending.length){const [item,depth]=pending.pop()!;check(++count<=8192&&depth<=32,'Evidence JSON is too complex.','TOO_LARGE');
      if(item===null||typeof item==='string'||typeof item==='boolean')continue;
      if(typeof item==='number'){check(Number.isFinite(item),'JSON numbers must be finite.','INVALID_REQUEST');continue;}
      check(Array.isArray(item)||object(item),'Only plain JSON evidence is accepted.','INVALID_REQUEST');
      for(const [key,child] of Object.entries(item)){check(!['__proto__','prototype','constructor'].includes(key),'Reserved JSON key.','INVALID_REQUEST');pending.push([child,depth+1]);}}
  }
  private async evidenceSeat(id:string,token:string,ended=false):Promise<string> {
    const row=(await this.row(id,this.pool,true)).data,seat=this.seat(row,token);if(ended)check(row.status!=='active','Completion opens after the episode ends.','EPISODE_ACTIVE');return seat;
  }
  private async lockStream(client:PoolClient,id:string,playerId:string):Promise<JsonObject> {
    await client.query('INSERT INTO coop_pg_streams(episode_id,player_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,playerId]);
    return (await client.query('SELECT data FROM coop_pg_streams WHERE episode_id=$1 AND player_id=$2 FOR UPDATE',[id,playerId])).rows[0].data;
  }
  private async putPrivate(client:PoolClient,id:string,kind:string,key:string,value:JsonObject):Promise<void> {
    const bytes=Buffer.byteLength(JSON.stringify(value))+128;await this.store.reserve(client,'messages',bytes,this.limits.maxMessageStoredBytesTotal);
    await client.query('INSERT INTO coop_pg_evidence(episode_id,kind,key,value,stored_bytes) VALUES($1,$2,$3,$4,$5)',[id,kind,key,value,bytes]);
  }
  async appendMessage(id:string,token:string,input:unknown):Promise<JsonObject> {
    const playerId=await this.evidenceSeat(id,token);this.validateJson(input);check(object(input),'Message envelope must be an object.','INVALID_REQUEST');
    exactKeys(input,['sequence','messageId','message','kind','model','provider','requestId','observationId','tokenUsage','reasoningAvailability','clientAt']);
    check(Number.isSafeInteger(input.sequence)&&input.sequence>=0,'sequence must be a nonnegative integer.','INVALID_REQUEST');
    check(typeof input.messageId==='string'&&/^[A-Za-z0-9._:-]{1,100}$/.test(input.messageId),'Invalid stable messageId.','INVALID_REQUEST');
    check(object(input.message)&&typeof input.message.role==='string'&&input.message.role.length>0&&input.message.role.length<=64,'message must retain its provider role.','INVALID_REQUEST');
    if(input.kind!==undefined)check(['model-input','model-output','tool-call','tool-result'].includes(input.kind),'Invalid message kind.','INVALID_REQUEST');
    for(const field of ['model','provider','requestId','observationId'])if(input[field]!==undefined)check(typeof input[field]==='string'&&input[field].length>0&&input[field].length<=200&&!/[\u0000-\u001f\u007f]/.test(input[field]),`Invalid ${field}.`,'INVALID_REQUEST');
    if(input.reasoningAvailability!==undefined)check(['provided','summary-only','not-provided','redacted'].includes(input.reasoningAvailability),'Invalid reasoning availability.','INVALID_REQUEST');
    if(input.tokenUsage!==undefined)check(object(input.tokenUsage)&&Buffer.byteLength(stable(input.tokenUsage))<=4096,'Invalid tokenUsage.','INVALID_REQUEST');
    if(input.clientAt!==undefined)check(typeof input.clientAt==='string'&&input.clientAt.length<=64&&/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(input.clientAt)&&Number.isFinite(Date.parse(input.clientAt)),'clientAt must be an ISO timestamp with timezone.','INVALID_REQUEST');
    check(Buffer.byteLength(stable(input))<=Math.min(48*1024,this.limits.maxMessageBytes),'Message too large; upload a chunked artifact.','TOO_LARGE');
    if(input.observationId){const observed=await this.store.evidence(id,'observation',input.observationId);check(observed?.player_id===playerId,'observationId must belong to this seat.','INVALID_REQUEST');}
    return this.store.transaction(async client=>{
      const stream=await this.lockStream(client,id,playerId),key=seatKey(playerId,input.sequence),prior=await this.store.evidence(id,'message',key,client);
      if(prior){check(prior.payloadHash===hash(input),'Sequence contains a different message.','IDEMPOTENCY_CONFLICT');return prior.record;}
      check(!stream.completion,'This private message stream is sealed.','MESSAGES_SEALED');
      check(input.sequence===(stream.messageCount??0),'Message sequence is not the next expected value.','MESSAGE_SEQUENCE_CONFLICT');
      check(input.sequence<this.limits.maxMessagesPerSeat,'Seat message capacity reached.','RESOURCE_LIMIT');
      check(!(await this.store.evidence(id,'message-id',seatKey(playerId,input.messageId),client)),'messageId already identifies a different sequence.','MESSAGE_ID_CONFLICT');
      const record={...input,episodeId:id,playerId,serverReceivedAt:new Date(await this.store.now(client)).toISOString(),provenance};
      await this.putPrivate(client,id,'message',key,{record,payloadHash:hash(input)});
      await this.putPrivate(client,id,'message-id',seatKey(playerId,input.messageId),{sequence:input.sequence});
      await client.query('UPDATE coop_pg_streams SET data=$3 WHERE episode_id=$1 AND player_id=$2',[id,playerId,{...stream,messageCount:input.sequence+1}]);return record;
    });
  }
  async completeMessages(id:string,token:string,input:unknown):Promise<JsonObject> {
    const playerId=await this.evidenceSeat(id,token,true);this.validateJson(input);check(object(input),'Invalid message completion.','INVALID_REQUEST');
    exactKeys(input,['scope','completeness','reasoningAvailability','model','provider','unavailable']);
    check(typeof input.scope==='string'&&input.scope.trim().length>0&&input.scope.length<=2000,'Describe the captured scope.','INVALID_REQUEST');
    check(['complete','partial'].includes(input.completeness)&&['provided','summary-only','not-provided','redacted'].includes(input.reasoningAvailability),'Invalid completeness or reasoning declaration.','INVALID_REQUEST');
    for(const field of ['model','provider'])if(input[field]!==undefined)check(typeof input[field]==='string'&&input[field].length>0&&input[field].length<=200,'Invalid provider metadata.','INVALID_REQUEST');
    if(input.unavailable!==undefined)check(Array.isArray(input.unavailable)&&input.unavailable.length<=16&&input.unavailable.every((v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=200),'Invalid unavailable field list.','INVALID_REQUEST');
    check(Buffer.byteLength(stable(input))<=8192,'Completion metadata too large.','TOO_LARGE');
    return this.store.transaction(async client=>{
      const stream=await this.lockStream(client,id,playerId);if(stream.completion){check(stream.completionHash===hash(input),'Stream has different completion metadata.','IDEMPOTENCY_CONFLICT');return stream.completion;}
      const completion={...input,episodeId:id,playerId,sealedAt:new Date(await this.store.now(client)).toISOString(),lastSequence:(stream.messageCount??0)-1,provenance};
      await this.putPrivate(client,id,'message-completion',playerId,completion);
      await client.query('UPDATE coop_pg_streams SET data=$3 WHERE episode_id=$1 AND player_id=$2',[id,playerId,{...stream,completion,completionHash:hash(input)}]);return completion;
    });
  }
  private async messagePage(id:string,playerId:string,after=-1,limit=50):Promise<JsonObject> {
    check(Number.isSafeInteger(after)&&after>=-1&&Number.isInteger(limit)&&limit>=1&&limit<=100,'Invalid message pagination.','INVALID_REQUEST');
    const rows=(await this.pool.query("SELECT value FROM coop_pg_evidence WHERE episode_id=$1 AND kind='message' AND key >= $2 AND key <= $3 ORDER BY key LIMIT $4",[id,seatKey(playerId,after+1),seatKey(playerId,Number.MAX_SAFE_INTEGER),limit+1])).rows;
    let bytes=0,hasMore=false;const messages:JsonObject[]=[];
    for(const {value} of rows){const size=Buffer.byteLength(JSON.stringify(value));if(messages.length>=limit||bytes+size>512*1024){hasMore=true;break;}bytes+=size;messages.push(value.record);}
    const stream=(await this.pool.query('SELECT data FROM coop_pg_streams WHERE episode_id=$1 AND player_id=$2',[id,playerId])).rows[0]?.data;
    return {episodeId:id,playerId,messages,nextAfter:messages.at(-1)?.sequence??after,hasMore,completion:stream?.completion??null,retention:this.privateRetention()};
  }
  async listSeatMessages(id:string,token:string,after=-1,limit=50){return this.messagePage(id,await this.evidenceSeat(id,token),after,limit);}
  async listRolloutMessages(id:string,playerId?:string,after=-1,limit=50):Promise<JsonObject> {
    const row=(await this.row(id,this.pool,true)).data;
    if(playerId!==undefined){check(row.seats[playerId],'Unknown player seat.','NOT_FOUND');return this.messagePage(id,playerId,after,limit);}
    const streams=new Map((await this.pool.query('SELECT player_id,data FROM coop_pg_streams WHERE episode_id=$1',[id])).rows.map(r=>[r.player_id,r.data]));
    return {episodeId:id,seats:Object.keys(row.seats).map(p=>{const data=streams.get(p);return {playerId:p,messageCount:data?.messageCount??0,lastSequence:(data?.messageCount??0)-1,completion:data?.completion??null};}),retention:this.privateRetention()};
  }
  private validateManifest(input:unknown):JsonObject {
    this.validateJson(input);check(object(input),'Artifact manifest must be an object.','INVALID_REQUEST');exactKeys(input,['name','mediaType','kind','byteLength','sha256','reasoningAvailability','model','provider','tokenCounts']);
    check(typeof input.name==='string'&&input.name.trim().length>0&&input.name.length<=200&&!/[\u0000-\u001f\u007f/\\]/.test(input.name)&&input.name!=='.'&&input.name!=='..','Invalid artifact filename.','INVALID_REQUEST');
    check(typeof input.mediaType==='string'&&/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+(?:; charset=utf-8)?$/.test(input.mediaType)&&input.mediaType.length<=120,'Invalid media type.','INVALID_REQUEST');
    check(['agent-trace','attachment'].includes(input.kind),'Invalid artifact kind.','INVALID_REQUEST');
    check(Number.isSafeInteger(input.byteLength)&&input.byteLength>=0&&input.byteLength<=Math.min(64*1024*1024,this.limits.maxArtifactBytes),'Artifact exceeds byte budget.','RESOURCE_LIMIT');
    check(typeof input.sha256==='string'&&/^[a-f0-9]{64}$/.test(input.sha256),'Invalid artifact SHA256.','INVALID_REQUEST');
    if(input.reasoningAvailability!==undefined)check(['provided','summary-only','not-provided','redacted'].includes(input.reasoningAvailability),'Invalid reasoning availability.','INVALID_REQUEST');
    for(const field of ['model','provider'])if(input[field]!==undefined)check(typeof input[field]==='string'&&input[field].length>0&&input[field].length<=200&&!/[\u0000-\u001f\u007f]/.test(input[field]),'Invalid model metadata.','INVALID_REQUEST');
    if(input.tokenCounts!==undefined)check(object(input.tokenCounts)&&Object.keys(input.tokenCounts).length<=16&&Object.entries(input.tokenCounts).every(([k,v])=>/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(k)&&Number.isSafeInteger(v)&&Number(v)>=0),'Invalid token counters.','INVALID_REQUEST');
    check(Buffer.byteLength(stable(input))<=8192,'Artifact manifest too large.','TOO_LARGE');return input;
  }
  private async artifactRow(id:string,artifactId:string,playerId?:string,client:PgClient=this.pool,lock=false):Promise<JsonObject> {
    const row=(await client.query(`SELECT * FROM coop_pg_artifacts WHERE episode_id=$1 AND id=$2 AND ($3::text IS NULL OR player_id=$3) ${lock?'FOR UPDATE':''}`,[id,artifactId,playerId??null])).rows[0];
    check(row,'Unknown artifact.','NOT_FOUND');return row;
  }
  private async artifactRecord(row:JsonObject,client:PgClient=this.pool):Promise<JsonObject> {
    const receivedChunks=(await client.query('SELECT chunk_index FROM coop_pg_chunks WHERE artifact_id=$1 ORDER BY chunk_index',[row.id])).rows.map(r=>r.chunk_index),received=new Set(receivedChunks),chunkCount=Math.ceil(row.data.byteLength/ARTIFACT_CHUNK_SIZE);
    return {...row.data,id:row.id,episodeId:row.episode_id,playerId:row.player_id,chunkSize:ARTIFACT_CHUNK_SIZE,chunkCount,receivedChunks,missingChunks:Array.from({length:chunkCount},(_,i)=>i).filter(i=>!received.has(i)),provenance};
  }
  async createArtifact(id:string,token:string,requestId:string,input:unknown):Promise<JsonObject> {
    const playerId=await this.evidenceSeat(id,token,true),manifest=this.validateManifest(input);
    check(typeof requestId==='string'&&/^[A-Za-z0-9._:-]{1,100}$/.test(requestId),'Invalid Idempotency-Key.','INVALID_REQUEST');
    return this.store.transaction(async client=>{
      await this.lockStream(client,id,playerId);
      const prior=(await client.query('SELECT * FROM coop_pg_artifacts WHERE episode_id=$1 AND player_id=$2 AND request_id=$3',[id,playerId,requestId])).rows[0];
      if(prior){check(prior.manifest_hash===hash(manifest),'Idempotency key was used for a different artifact.','IDEMPOTENCY_CONFLICT');return this.artifactRecord(prior,client);}
      const count=Number((await client.query('SELECT count(*) n FROM coop_pg_artifacts WHERE episode_id=$1 AND player_id=$2',[id,playerId])).rows[0].n);
      check(count<this.limits.maxArtifactsPerSeat,'Seat artifact count budget reached.','RESOURCE_LIMIT');
      const reserved=manifest.byteLength+Buffer.byteLength(stable(manifest))+Math.ceil(manifest.byteLength/ARTIFACT_CHUNK_SIZE)*128;
      await this.store.reserve(client,'artifacts',reserved,this.limits.maxArtifactStoredBytesTotal);
      const artifactId=randomUUID(),data={...manifest,status:'uploading',createdAt:new Date(await this.store.now(client)).toISOString(),completedAt:null};
      const inserted=(await client.query('INSERT INTO coop_pg_artifacts(id,episode_id,player_id,request_id,manifest_hash,data,reserved_bytes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[artifactId,id,playerId,requestId,hash(manifest),data,reserved])).rows[0];
      return this.artifactRecord(inserted,client);
    });
  }
  async putArtifactChunk(id:string,token:string,artifactId:string,input:unknown):Promise<JsonObject> {
    const playerId=await this.evidenceSeat(id,token,true);check(object(input),'Invalid chunk.','INVALID_REQUEST');exactKeys(input,['index','dataBase64']);
    check(Number.isSafeInteger(input.index)&&input.index>=0&&typeof input.dataBase64==='string'&&input.dataBase64.length<=Math.ceil(ARTIFACT_CHUNK_SIZE/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.dataBase64),'Invalid chunk encoding.','INVALID_REQUEST');
    const bytes=Buffer.from(input.dataBase64,'base64');check(bytes.toString('base64')===input.dataBase64,'Noncanonical base64.','INVALID_REQUEST');
    return this.store.transaction(async client=>{
      const row=await this.artifactRow(id,artifactId,playerId,client,true),count=Math.ceil(row.data.byteLength/ARTIFACT_CHUNK_SIZE);
      check(input.index<count&&bytes.length===Math.min(ARTIFACT_CHUNK_SIZE,row.data.byteLength-input.index*ARTIFACT_CHUNK_SIZE),'Chunk does not match manifest size.','INVALID_REQUEST');
      const prior=(await client.query('SELECT data FROM coop_pg_chunks WHERE artifact_id=$1 AND chunk_index=$2',[artifactId,input.index])).rows[0];
      if(prior){check(prior.data.equals(bytes),'A different chunk occupies this index.','IDEMPOTENCY_CONFLICT');return this.artifactRecord(row,client);}
      check(row.data.status==='uploading','Completed artifacts are immutable.','ARTIFACT_COMPLETE');
      await client.query('INSERT INTO coop_pg_chunks VALUES($1,$2,$3)',[artifactId,input.index,bytes]);return this.artifactRecord(row,client);
    });
  }
  async completeArtifact(id:string,token:string,artifactId:string):Promise<JsonObject> {
    const playerId=await this.evidenceSeat(id,token,true);
    return this.store.transaction(async client=>{
      const row=await this.artifactRow(id,artifactId,playerId,client,true);if(row.data.status==='complete')return this.artifactRecord(row,client);
      const record=await this.artifactRecord(row,client);check(record.missingChunks.length===0,'Upload is incomplete.','ARTIFACT_INCOMPLETE');
      const digest=createHash('sha256');let bytes=0;
      // Bounded 32 KiB reads keep completing a 64 MiB artifact out of the process heap.
      for(let i=0;i<record.chunkCount;i++){const chunk=(await client.query('SELECT data FROM coop_pg_chunks WHERE artifact_id=$1 AND chunk_index=$2',[artifactId,i])).rows[0].data;digest.update(chunk);bytes+=chunk.length;}
      check(bytes===record.byteLength&&digest.digest('hex')===record.sha256,'Artifact SHA256 or length mismatch. Partial evidence remains stored.','ARTIFACT_DIGEST_MISMATCH');
      row.data={...row.data,status:'complete',completedAt:new Date(await this.store.now(client)).toISOString()};await client.query('UPDATE coop_pg_artifacts SET data=$2 WHERE id=$1',[artifactId,row.data]);return this.artifactRecord(row,client);
    });
  }
  private async artifactList(id:string,playerId?:string):Promise<JsonObject> {
    const rows=(await this.pool.query('SELECT * FROM coop_pg_artifacts WHERE episode_id=$1 AND ($2::text IS NULL OR player_id=$2) ORDER BY id',[id,playerId??null])).rows;
    return {artifacts:await Promise.all(rows.map(row=>this.artifactRecord(row))),retention:{...this.privateRetention(),chunkSize:ARTIFACT_CHUNK_SIZE}};
  }
  async listSeatArtifacts(id:string,token:string){return this.artifactList(id,await this.evidenceSeat(id,token));}
  async listRolloutArtifacts(id:string){await this.row(id,this.pool,true);return this.artifactList(id);}
  private async artifactContent(id:string,artifactId:string,playerId?:string):Promise<{artifact:JsonObject;chunks:AsyncIterable<Buffer>}> {
    const artifact=await this.artifactRecord(await this.artifactRow(id,artifactId,playerId));check(artifact.status==='complete','Artifact must pass size and digest validation before download.','ARTIFACT_INCOMPLETE');const pool=this.pool;
    return {artifact,chunks:(async function*(){for(let i=0;i<artifact.chunkCount;i++){const chunk=(await pool.query('SELECT data FROM coop_pg_chunks WHERE artifact_id=$1 AND chunk_index=$2',[artifactId,i])).rows[0];check(chunk,'Stored artifact chunk missing.','INTERNAL');yield chunk.data as Buffer;}})()};
  }
  async seatArtifactContent(id:string,token:string,artifactId:string){return this.artifactContent(id,artifactId,await this.evidenceSeat(id,token));}
  async rolloutArtifactContent(id:string,artifactId:string){await this.row(id,this.pool,true);return this.artifactContent(id,artifactId);}
}
