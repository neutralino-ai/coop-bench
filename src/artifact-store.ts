import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { check, object } from './common.ts';

export const ARTIFACT_CHUNK_SIZE=32*1024;
export interface ArtifactLimits {maxArtifactBytes:number;maxArtifactsPerSeat:number;maxArtifactStoredBytesTotal:number;}
export const DEFAULT_ARTIFACT_LIMITS:Readonly<ArtifactLimits>=Object.freeze({maxArtifactBytes:64*1024*1024,maxArtifactsPerSeat:16,maxArtifactStoredBytesTotal:8*1024*1024*1024});
export interface ArtifactManifest {
  name:string;mediaType:string;kind:'agent-trace'|'attachment';byteLength:number;sha256:string;
  reasoningAvailability?:'provided'|'summary-only'|'not-provided'|'redacted';
  model?:string;provider?:string;tokenCounts?:Record<string,number>;
}
export interface ArtifactRecord extends ArtifactManifest {
  id:string;episodeId:string;playerId:string;status:'uploading'|'complete';createdAt:string;completedAt:string|null;
  chunkSize:number;chunkCount:number;receivedChunks:number[];missingChunks:number[];provenance:'client-supplied-unverified';
}
interface ArtifactRow {id:string;episode_id:string;player_id:string;request_id:string;manifest:string;manifest_hash:string;status:'uploading'|'complete';created_at:string;completed_at:string|null;reserved_bytes:number;}
const stable=(v:any):string=>Array.isArray(v)?`[${v.map(stable).join(',')}]`:object(v)?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`:JSON.stringify(v);
const sha=(v:string|Uint8Array):string=>createHash('sha256').update(v).digest('hex');

/** Immutable client evidence. This store does not parse, endorse, execute, or
 * reconstruct reasoning. Both partial and completed uploads have no expiry. */
export class ArtifactStore {
  readonly db:DatabaseSync;readonly limits:Readonly<ArtifactLimits>;
  constructor(db:DatabaseSync,limits:Partial<ArtifactLimits>={}) {
    this.db=db;this.limits=Object.freeze({...DEFAULT_ARTIFACT_LIMITS,...limits});
    for(const value of Object.values(this.limits))check(Number.isSafeInteger(value)&&value>0,'Artifact budgets must be positive safe integers.','INVALID_CONFIG');
    check(this.limits.maxArtifactBytes<=64*1024*1024,'An artifact cannot exceed the 64 MiB safety ceiling.','INVALID_CONFIG');
    this.db.exec(`CREATE TABLE IF NOT EXISTS artifacts(
      id TEXT PRIMARY KEY,episode_id TEXT NOT NULL,player_id TEXT NOT NULL,request_id TEXT NOT NULL,
      manifest TEXT NOT NULL,manifest_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('uploading','complete')),
      created_at TEXT NOT NULL,completed_at TEXT,reserved_bytes INTEGER NOT NULL,
      FOREIGN KEY(episode_id,player_id) REFERENCES seats(episode_id,player_id),UNIQUE(episode_id,player_id,request_id));
      CREATE TABLE IF NOT EXISTS artifact_chunks(artifact_id TEXT NOT NULL REFERENCES artifacts(id),chunk_index INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(artifact_id,chunk_index));
      CREATE INDEX IF NOT EXISTS artifacts_episode_seat ON artifacts(episode_id,player_id);
      CREATE TRIGGER IF NOT EXISTS artifact_chunks_no_update BEFORE UPDATE ON artifact_chunks BEGIN SELECT RAISE(ABORT,'Artifact chunks are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS artifacts_manifest_immutable BEFORE UPDATE OF episode_id,player_id,request_id,manifest,manifest_hash,reserved_bytes,created_at ON artifacts BEGIN SELECT RAISE(ABORT,'Artifact manifests are immutable'); END;`);
  }
  private transaction<T>(run:()=>T):T {
    this.db.exec('BEGIN IMMEDIATE');
    try{const result=run();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  private validate(value:unknown):ArtifactManifest {
    check(object(value),'Artifact manifest must be an object.','INVALID_REQUEST');
    const keys=['name','mediaType','kind','byteLength','sha256','reasoningAvailability','model','provider','tokenCounts'];
    check(Object.keys(value).every(key=>keys.includes(key)),'Unknown artifact manifest field.','INVALID_REQUEST');
    check(typeof value.name==='string'&&value.name.trim().length>0&&value.name.length<=200&&!/[\u0000-\u001f\u007f/\\]/.test(value.name)&&value.name!=='.'&&value.name!=='..','Artifact name must be a short filename without path separators or control characters.','INVALID_REQUEST');
    check(typeof value.mediaType==='string'&&/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+(?:; charset=utf-8)?$/.test(value.mediaType)&&value.mediaType.length<=120,'Invalid artifact media type.','INVALID_REQUEST');
    check(value.kind==='agent-trace'||value.kind==='attachment','Artifact kind must be agent-trace or attachment.','INVALID_REQUEST');
    check(Number.isSafeInteger(value.byteLength)&&value.byteLength>=0,'Invalid artifact byte length.','INVALID_REQUEST');
    check(value.byteLength<=64*1024*1024,'Artifact exceeds the per-file safety ceiling.','RESOURCE_LIMIT');
    check(typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256),'Artifact SHA256 must be 64 lowercase hex characters.','INVALID_REQUEST');
    if(value.reasoningAvailability!==undefined)check(['provided','summary-only','not-provided','redacted'].includes(value.reasoningAvailability),'Invalid reasoning availability.','INVALID_REQUEST');
    for(const field of ['model','provider'])if(value[field]!==undefined)check(typeof value[field]==='string'&&value[field].length>0&&value[field].length<=200&&!/[\u0000-\u001f\u007f]/.test(value[field]),`Invalid artifact ${field}.`,'INVALID_REQUEST');
    if(value.tokenCounts!==undefined){
      check(object(value.tokenCounts)&&Object.keys(value.tokenCounts).length<=16,'tokenCounts must contain at most 16 counters.','INVALID_REQUEST');
      for(const [key,count] of Object.entries(value.tokenCounts))check(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)&&!['constructor','prototype','__proto__'].includes(key)&&Number.isSafeInteger(count)&&Number(count)>=0,'Invalid token counter.','INVALID_REQUEST');
    }
    check(Buffer.byteLength(stable(value))<=8192,'Artifact metadata is too large.','INVALID_REQUEST');
    return value as ArtifactManifest;
  }
  private row(episodeId:string,id:string,playerId?:string):ArtifactRow {
    const row=this.db.prepare(`SELECT * FROM artifacts WHERE episode_id=? AND id=?${playerId===undefined?'':' AND player_id=?'}`).get(...(playerId===undefined?[episodeId,id]:[episodeId,id,playerId])) as unknown as ArtifactRow|undefined;
    check(row,'Unknown artifact.','NOT_FOUND');return row;
  }
  private record(row:ArtifactRow):ArtifactRecord {
    const manifest=JSON.parse(row.manifest) as ArtifactManifest,chunkCount=Math.ceil(manifest.byteLength/ARTIFACT_CHUNK_SIZE);
    const receivedChunks=this.db.prepare('SELECT chunk_index FROM artifact_chunks WHERE artifact_id=? ORDER BY chunk_index').all(row.id).map(r=>Number(r.chunk_index));
    const received=new Set(receivedChunks),missingChunks=Array.from({length:chunkCount},(_,i)=>i).filter(i=>!received.has(i));
    return {...manifest,id:row.id,episodeId:row.episode_id,playerId:row.player_id,status:row.status,createdAt:row.created_at,completedAt:row.completed_at,
      chunkSize:ARTIFACT_CHUNK_SIZE,chunkCount,receivedChunks,missingChunks,provenance:'client-supplied-unverified'};
  }
  retention(includeUsage=true) {
    const row=includeUsage?this.db.prepare("SELECT COALESCE(SUM(reserved_bytes),0) AS reserved,COUNT(*) AS count,COALESCE(SUM(status='complete'),0) AS complete FROM artifacts").get()!:undefined;
    return {policy:'indefinite',automaticDeletion:false,automaticExpiry:false,onCapacity:'reject-new-writes',partialUploadsRetained:true,
      chunkSize:ARTIFACT_CHUNK_SIZE,...this.limits,...(row?{reservedBytes:Number(row.reserved),artifactCount:Number(row.count),completeCount:Number(row.complete)}:{}),
      accounting:'Declared payload plus metadata and 128 bytes per chunk are reserved atomically; SQLite pages, indexes, WAL and backups use additional disk space.',
      provenance:'client-supplied-unverified',evidenceBoundary:'Server records API traffic; complete client transcripts must be uploaded separately. Unavailable private reasoning cannot be reconstructed by the server.'};
  }
  create(episodeId:string,playerId:string,requestId:string,input:unknown):ArtifactRecord {
    check(typeof requestId==='string'&&/^[A-Za-z0-9._:-]{1,100}$/.test(requestId),'A 1–100 character Idempotency-Key is required.','INVALID_REQUEST');
    const manifest=this.validate(input),serialized=stable(manifest),hash=sha(serialized);
    return this.transaction(()=>{
      const prior=this.db.prepare('SELECT * FROM artifacts WHERE episode_id=? AND player_id=? AND request_id=?').get(episodeId,playerId,requestId) as unknown as ArtifactRow|undefined;
      if(prior){check(prior.manifest_hash===hash,'Idempotency key was used for a different manifest.','IDEMPOTENCY_CONFLICT');return this.record(prior);}
      check(manifest.byteLength<=this.limits.maxArtifactBytes,'Artifact exceeds the configured per-file byte budget.','RESOURCE_LIMIT');
      const count=Number(this.db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE episode_id=? AND player_id=?').get(episodeId,playerId)!.n);
      check(count<this.limits.maxArtifactsPerSeat,'Artifact count budget reached for this seat; existing evidence is retained.','RESOURCE_LIMIT');
      const reservation=manifest.byteLength+Buffer.byteLength(serialized)+Math.ceil(manifest.byteLength/ARTIFACT_CHUNK_SIZE)*128;
      const reserved=Number(this.db.prepare('SELECT COALESCE(SUM(reserved_bytes),0) AS n FROM artifacts').get()!.n);
      check(reservation<=this.limits.maxArtifactStoredBytesTotal-reserved,'Artifact storage budget reached; existing evidence is retained. Increase capacity to accept new uploads.','RESOURCE_LIMIT');
      const id=randomUUID();this.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,episodeId,playerId,requestId,serialized,hash,'uploading',new Date().toISOString(),null,reservation);
      return this.record(this.row(episodeId,id,playerId));
    });
  }
  list(episodeId:string,playerId?:string):ArtifactRecord[] {
    const rows=this.db.prepare(`SELECT * FROM artifacts WHERE episode_id=?${playerId===undefined?'':' AND player_id=?'} ORDER BY created_at,id`).all(...(playerId===undefined?[episodeId]:[episodeId,playerId])) as unknown as ArtifactRow[];
    return rows.map(row=>this.record(row));
  }
  chunk(episodeId:string,playerId:string,id:string,input:unknown):ArtifactRecord {
    check(object(input)&&Object.keys(input).length===2&&Object.keys(input).every(k=>['index','dataBase64'].includes(k)),'A chunk requires index and dataBase64.','INVALID_REQUEST');
    check(Number.isSafeInteger(input.index)&&input.index>=0,'Invalid chunk index.','INVALID_REQUEST');
    check(typeof input.dataBase64==='string'&&input.dataBase64.length<=Math.ceil(ARTIFACT_CHUNK_SIZE/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.dataBase64),'Invalid chunk base64.','INVALID_REQUEST');
    const bytes=Buffer.from(input.dataBase64,'base64');check(bytes.toString('base64')===input.dataBase64,'Noncanonical chunk base64.','INVALID_REQUEST');
    return this.transaction(()=>{
      const row=this.row(episodeId,id,playerId),manifest=JSON.parse(row.manifest) as ArtifactManifest;
      const count=Math.ceil(manifest.byteLength/ARTIFACT_CHUNK_SIZE);
      check(input.index<count&&bytes.length===Math.min(ARTIFACT_CHUNK_SIZE,manifest.byteLength-input.index*ARTIFACT_CHUNK_SIZE),'Chunk index or byte length does not match the manifest.','INVALID_REQUEST');
      const existing=this.db.prepare('SELECT data FROM artifact_chunks WHERE artifact_id=? AND chunk_index=?').get(id,input.index);
      if(existing){check(Buffer.from(existing.data as Uint8Array).equals(bytes),'A different chunk already occupies this index.','IDEMPOTENCY_CONFLICT');return this.record(row);}
      check(row.status==='uploading','Completed artifacts are immutable.','ARTIFACT_COMPLETE');
      this.db.prepare('INSERT INTO artifact_chunks VALUES(?,?,?)').run(id,input.index,bytes);return this.record(row);
    });
  }
  complete(episodeId:string,playerId:string,id:string):ArtifactRecord {
    return this.transaction(()=>{
      const row=this.row(episodeId,id,playerId);if(row.status==='complete')return this.record(row);
      const record=this.record(row);check(record.missingChunks.length===0,'Upload is incomplete; resume the missing chunks.','ARTIFACT_INCOMPLETE');
      const hash=createHash('sha256');let length=0;
      for(const chunk of this.db.prepare('SELECT data FROM artifact_chunks WHERE artifact_id=? ORDER BY chunk_index').iterate(id)){
        const bytes=chunk.data as Uint8Array;length+=bytes.byteLength;hash.update(bytes);
      }
      check(length===record.byteLength&&hash.digest('hex')===record.sha256,'Uploaded bytes do not match the declared size and SHA256. Partial evidence is retained; create a new manifest to correct the upload.','ARTIFACT_DIGEST_MISMATCH');
      this.db.prepare("UPDATE artifacts SET status='complete',completed_at=? WHERE id=?").run(new Date().toISOString(),id);
      return this.record(this.row(episodeId,id,playerId));
    });
  }
  content(episodeId:string,id:string,playerId?:string):{artifact:ArtifactRecord;chunks:Iterable<Buffer>} {
    const artifact=this.record(this.row(episodeId,id,playerId));check(artifact.status==='complete','Artifact download is available after size and SHA256 verification.','ARTIFACT_INCOMPLETE');
    const db=this.db;
    return {artifact,chunks:(function*(){for(let i=0;i<artifact.chunkCount;i++){
      const row=db.prepare('SELECT data FROM artifact_chunks WHERE artifact_id=? AND chunk_index=?').get(id,i);check(row,'Stored artifact chunk is missing.','INTERNAL');yield Buffer.from(row.data as Uint8Array);
    }})()};
  }
}
