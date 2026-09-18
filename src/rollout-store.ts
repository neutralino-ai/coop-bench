import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { check, object, players } from './common.ts';
import type { JsonObject } from './types.ts';

export interface RolloutLimits {
  maxAnnotationsPerEpisode:number;
  maxAnnotationsPerSeat:number;
  maxAnnotationBytesPerEpisode:number;
}
export const DEFAULT_ROLLOUT_LIMITS:Readonly<RolloutLimits>=Object.freeze({
  maxAnnotationsPerEpisode:100,maxAnnotationsPerSeat:20,maxAnnotationBytesPerEpisode:256*1024,
});

/** Historical evidence is deliberately independent of the currently installed game engine. */
export class RolloutStore {
  readonly db:DatabaseSync;
  readonly build:string;
  readonly limits:Readonly<RolloutLimits>;
  constructor(db:DatabaseSync, build:string, limits:Partial<RolloutLimits>={}) {
    this.db=db;this.build=build;this.limits=Object.freeze({...DEFAULT_ROLLOUT_LIMITS,...limits});
    for(const value of Object.values(this.limits))check(Number.isSafeInteger(value)&&value>0,'Resource limits must be positive safe integers.','INVALID_CONFIG');
    db.exec(`CREATE TABLE IF NOT EXISTS rollout_frames(
      episode_id TEXT NOT NULL REFERENCES episodes(id),seq INTEGER NOT NULL,payload TEXT NOT NULL,
      PRIMARY KEY(episode_id,seq));
      CREATE TABLE IF NOT EXISTS rollout_annotations(
      id TEXT PRIMARY KEY,episode_id TEXT NOT NULL REFERENCES episodes(id),kind TEXT NOT NULL,
      player_id TEXT,text TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS rollout_annotations_episode ON rollout_annotations(episode_id,created_at);
      CREATE INDEX IF NOT EXISTS rollout_observations_episode ON observations(episode_id);`);
  }
  /** Store only projected seat information; action credentials have no place in the audit UI. */
  static safeObservation(observed:JsonObject|null|undefined):JsonObject|null {
    if(!observed)return null;
    const {decisionToken,...safe}=observed;
    return safe;
  }
  record(id:string,frame:JsonObject):void {
    this.db.prepare('INSERT INTO rollout_frames VALUES(?,?,?)').run(id,frame.seq,JSON.stringify(frame));
  }
  private row(id:string):JsonObject {
    const row=this.db.prepare('SELECT * FROM episodes WHERE id=?').get(id);
    check(row,'Unknown episode.','NOT_FOUND');return row;
  }
  private events(id:string):JsonObject[] {
    return this.db.prepare('SELECT * FROM events WHERE episode_id=? ORDER BY seq').all(id).map(e=>({...e,payload:JSON.parse(e.payload as string)}));
  }
  private issued(id:string):Map<string,JsonObject> {
    return new Map(this.db.prepare('SELECT id,player_id,payload FROM observations WHERE episode_id=? ORDER BY rowid').all(id)
      .map(o=>[String(o.id),{playerId:o.player_id,payload:JSON.parse(o.payload as string)}]));
  }
  /** Missing historical seat views stay missing. No engine replay or future-view backfill. */
  private frames(row:JsonObject,events:JsonObject[],issued:Map<string,JsonObject>):JsonObject[] {
    const stored=new Map(this.db.prepare('SELECT seq,payload FROM rollout_frames WHERE episode_id=? ORDER BY seq').all(row.id).map(f=>[Number(f.seq),JSON.parse(f.payload as string)]));
    return events.map(event=>{
      if(stored.has(event.seq))return stored.get(event.seq);
      const payload=event.payload,command=payload.command,source=command?issued.get(command.observationId):null;
      const observed=source?.playerId===event.player_id ? RolloutStore.safeObservation(source.payload):null;
      const after=payload.response?.observation;
      const validAfter=after?.episodeId===row.id && after?.playerId===event.player_id ? after:null;
      const views:JsonObject=validAfter?{[event.player_id]:RolloutStore.safeObservation(validAfter)}:{};
      return {seq:event.seq,at:event.received_at,kind:event.kind,playerId:event.player_id,
        requestId:payload.requestId??null,action:command?.action??null,decisionSummary:command?.decisionSummary??null,
        error:payload.response?.error??null,stateHash:event.state_hash,observed,views,
        viewProvenance:validAfter?{[event.player_id]:'issued-observation'}:{},
        outcome:validAfter?.outcome??null,status:validAfter?.status??(event.kind==='truncated'?'truncated':null),
        coverage:validAfter?'actor-only':'unavailable',
        ...(event.kind==='elapsed'?{elapsedMs:payload.elapsedMs}:{}),
        ...(event.kind==='truncated'?{reason:payload.reason}:{}),
        evidence:'legacy-issued-observations'};
    });
  }
  private annotations(id:string):JsonObject[] {
    return this.db.prepare('SELECT * FROM rollout_annotations WHERE episode_id=? ORDER BY created_at,rowid').all(id)
      .map(a=>({id:a.id,kind:a.kind,playerId:a.player_id??null,text:a.text,source:a.source,createdAt:a.created_at}));
  }
  private summary(row:JsonObject,frames:JsonObject[],issued:Map<string,JsonObject>,annotations:JsonObject[]):JsonObject {
    const options=JSON.parse(row.options),metadata=JSON.parse(row.metadata);
    // Some old episodes completed on a command whose receipt is the only outcome evidence.
    const terminalFrame=[...frames].reverse().find(f=>f.status==='completed' && f.outcome);
    const terminalIssued=[...issued.values()].reverse().find(o=>o.payload.status==='completed' && o.payload.outcome);
    const outcome=row.status==='completed' ? terminalFrame?.outcome??terminalIssued?.payload.outcome??null:null;
    const dates=[...frames.map(f=>f.at),...annotations.map(a=>a.createdAt)].filter(Boolean).sort();
    return {episodeId:row.id,gameId:row.game_id,gameName:metadata.name,scenarioId:options.scenarioId,
      playerCount:options.playerCount,status:row.status,createdAt:frames[0]?.at??null,updatedAt:dates.at(-1)??null,
      eventCount:frames.length,actionCount:frames.filter(f=>f.kind==='accepted').length,
      rejectedCount:frames.filter(f=>f.kind==='rejected').length,outcome,outcomeDetailsAvailable:outcome?.details!==undefined,build:row.build,compatibleBuild:row.build===this.build,
      coverage:frames.every(f=>f.coverage==='recorded')?'recorded':frames.some(f=>Object.keys(f.views).length)?'actor-only':'unavailable'};
  }
  get(id:string):JsonObject {
    const row=this.row(id),events=this.events(id),issued=this.issued(id),frames=this.frames(row,events,issued),annotations=this.annotations(id);
    return {schemaVersion:'coop-bench-rollout-v1',summary:this.summary(row,frames,issued,annotations),metadata:JSON.parse(row.metadata),
      players:players(JSON.parse(row.options).playerCount),frames,annotations,endReason:row.end_reason,
      evidenceNotes:[
        'observed is the observation explicitly bound to this action, not a reconstruction of private reasoning.',
        'server-projection means a view was prepared at that event; issued-observation means the server issued it. Neither proves client receipt.',
        'Absent views in historical frames are unavailable. Later hands are never substituted for earlier observations.',
        'decisionSummary and annotations are player or reviewer statements, not verified hidden chain of thought.',
        'Historical evidence can be inspected across engine builds. Replay verification requires the pinned build.'
      ]};
  }
  /** List summaries must not materialize full histories or private views in JS.
   * SQLite extracts only the small evidence fields used by summary(). The same
   * legacy validity checks are applied before treating a receipt as a seat view. */
  private listSummary(row:JsonObject):JsonObject {
    const validAfter=`json_extract(e.payload,'$.response.observation.episodeId')=e.episode_id
      AND json_extract(e.payload,'$.response.observation.playerId')=e.player_id`;
    const joined=`FROM events e LEFT JOIN rollout_frames f ON f.episode_id=e.episode_id AND f.seq=e.seq WHERE e.episode_id=?`;
    const stats=this.db.prepare(`WITH frame_summary AS (
      SELECT e.seq,
        CASE WHEN f.payload IS NOT NULL THEN json_extract(f.payload,'$.at') ELSE e.received_at END AS at,
        CASE WHEN f.payload IS NOT NULL THEN json_extract(f.payload,'$.kind') ELSE e.kind END AS kind,
        CASE WHEN f.payload IS NOT NULL THEN json_extract(f.payload,'$.coverage')
          WHEN ${validAfter} THEN 'actor-only' ELSE 'unavailable' END AS coverage,
        CASE WHEN f.payload IS NOT NULL THEN EXISTS(SELECT 1 FROM json_each(f.payload,'$.views'))
          WHEN ${validAfter} THEN 1 ELSE 0 END AS has_views
      ${joined})
      SELECT COUNT(*) AS event_count,COALESCE(SUM(kind='accepted'),0) AS action_count,
        COALESCE(SUM(kind='rejected'),0) AS rejected_count,COALESCE(SUM(coverage='recorded'),0) AS recorded_count,
        COALESCE(MAX(has_views),0) AS has_views,MAX(at) AS latest_at,
        (SELECT at FROM frame_summary ORDER BY seq LIMIT 1) AS created_at FROM frame_summary`).get(row.id)!;
    let outcome:any=null;
    if(row.status==='completed') {
      const state=`CASE WHEN f.payload IS NOT NULL THEN json_extract(f.payload,'$.status')
        WHEN ${validAfter} THEN json_extract(e.payload,'$.response.observation.status') ELSE NULL END`;
      const result=`CASE WHEN f.payload IS NOT NULL THEN json_extract(f.payload,'$.outcome')
        WHEN ${validAfter} THEN json_extract(e.payload,'$.response.observation.outcome') ELSE NULL END`;
      const terminal=this.db.prepare(`SELECT ${result} AS outcome ${joined}
        AND (${state})='completed' AND (${result}) IS NOT NULL ORDER BY e.seq DESC LIMIT 1`).get(row.id);
      // Old terminal timeouts can have an issued observation without an action receipt.
      const evidence=terminal??this.db.prepare(`SELECT json_extract(payload,'$.outcome') AS outcome FROM observations
        WHERE episode_id=? AND json_extract(payload,'$.status')='completed'
          AND json_extract(payload,'$.outcome') IS NOT NULL ORDER BY rowid DESC LIMIT 1`).get(row.id);
      outcome=evidence?JSON.parse(evidence.outcome as string):null;
    }
    const annotation=this.db.prepare('SELECT MAX(created_at) AS at FROM rollout_annotations WHERE episode_id=?').get(row.id)!;
    const updated=[stats.latest_at,annotation.at].filter(Boolean).sort().at(-1)??null;
    return {episodeId:row.id,gameId:row.game_id,gameName:row.game_name,scenarioId:row.scenario_id,
      playerCount:row.player_count,status:row.status,createdAt:stats.created_at??null,updatedAt:updated,
      eventCount:Number(stats.event_count),actionCount:Number(stats.action_count),rejectedCount:Number(stats.rejected_count),
      outcome,outcomeDetailsAvailable:outcome?.details!==undefined,build:row.build,compatibleBuild:row.build===this.build,
      coverage:stats.recorded_count===stats.event_count?'recorded':stats.has_views?'actor-only':'unavailable'};
  }
  list(options:{limit?:number;offset?:number;status?:string;gameId?:string}={}):JsonObject {
    const {limit=50,offset=0,status,gameId}=options;
    check(Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'limit must be between 1 and 200.','INVALID_REQUEST');
    check(Number.isSafeInteger(offset)&&offset>=0,'offset must be a nonnegative integer.','INVALID_REQUEST');
    check(status===undefined||['active','completed','truncated'].includes(status),'Unknown rollout status.','INVALID_REQUEST');
    check(gameId===undefined||(typeof gameId==='string'&&gameId.length>0&&gameId.length<=100),'Invalid game ID.','INVALID_REQUEST');
    const where:string[]=[],args:string[]=[];
    if(status!==undefined){where.push('status=?');args.push(status);}
    if(gameId!==undefined){where.push('game_id=?');args.push(gameId);}
    const clause=where.length?` WHERE ${where.join(' AND ')}`:'';
    const total=Number(this.db.prepare(`SELECT COUNT(*) AS n FROM episodes${clause}`).get(...args)!.n);
    const rows=this.db.prepare(`SELECT id,game_id,status,build,json_extract(metadata,'$.name') AS game_name,
      json_extract(options,'$.scenarioId') AS scenario_id,json_extract(options,'$.playerCount') AS player_count
      FROM episodes${clause} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(...args,limit,offset);
    return {items:rows.map(row=>this.listSummary(row)),total,limit,offset};
  }
  annotate(id:string,input:{kind:'reflection'|'review';playerId?:string;text:string;source?:string},seatPlayer?:string):JsonObject {
    const row=this.row(id);
    check(object(input)&&Object.keys(input).every(k=>['kind','playerId','text','source'].includes(k)),'Invalid annotation.','INVALID_REQUEST');
    check(input.kind==='reflection'||input.kind==='review','Unknown annotation kind.','INVALID_REQUEST');
    check(typeof input.text==='string'&&input.text.trim().length>0&&input.text.length<=20000,'Annotation text must contain 1–20000 characters.','INVALID_REQUEST');
    check(input.playerId===undefined||players(JSON.parse(row.options).playerCount).includes(input.playerId),'Unknown player.','INVALID_REQUEST');
    check(input.source===undefined||(typeof input.source==='string'&&input.source.length<=200),'Invalid source label.','INVALID_REQUEST');
    if(input.kind==='reflection')check(row.status!=='active','Reflection opens after completion or truncation.','EPISODE_ACTIVE');
    const usage=this.db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(text AS BLOB))),0) AS bytes FROM rollout_annotations WHERE episode_id=?').get(id)!;
    check(Number(usage.n)<this.limits.maxAnnotationsPerEpisode,'Episode annotation count limit reached.','RESOURCE_LIMIT');
    check(Number(usage.bytes)+Buffer.byteLength(input.text.trim(),'utf8')<=this.limits.maxAnnotationBytesPerEpisode,'Episode annotation byte limit reached.','RESOURCE_LIMIT');
    if(seatPlayer) {
      const count=this.db.prepare("SELECT COUNT(*) AS n FROM rollout_annotations WHERE episode_id=? AND player_id=? AND source='seat'").get(id,seatPlayer)!;
      check(Number(count.n)<this.limits.maxAnnotationsPerSeat,'Seat reflection limit reached.','RESOURCE_LIMIT');
    }
    const annotation={id:randomUUID(),kind:input.kind,playerId:seatPlayer??input.playerId??null,text:input.text.trim(),
      source:seatPlayer?'seat':input.source&&input.source!=='coordinator'?`coordinator:${input.source}`:'coordinator',createdAt:new Date().toISOString()};
    this.db.prepare('INSERT INTO rollout_annotations VALUES(?,?,?,?,?,?,?)').run(annotation.id,id,annotation.kind,annotation.playerId,annotation.text,annotation.source,annotation.createdAt);
    return annotation;
  }
}
