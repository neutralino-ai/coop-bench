import pg from 'pg';
import type { Pool, PoolClient } from 'pg';
import { check } from './common.ts';
import type { JsonObject } from './types.ts';

export type PgClient = Pool | PoolClient;
export interface StoredEpisode {id:string;revision:number;data:JsonObject;}
export interface EvidenceWrite {kind:string;key:string;value:JsonObject;}

/** PostgreSQL is authoritative. No game cache or local file is consulted by this store.
 * Rows contain the small current game snapshot; growing histories live separately. */
export class PostgresStore {
  readonly pool:Pool;
  private readonly ownsPool:boolean;
  private initialization:Promise<void>|undefined;
  constructor(connection:string|Pool) {
    this.ownsPool=typeof connection==='string';
    this.pool=typeof connection==='string'?new pg.Pool({connectionString:connection,max:20,connectionTimeoutMillis:10000,idleTimeoutMillis:30000}):connection;
  }
  ready():Promise<void> {return this.initialization??=this.initialize();}
  private async initialize():Promise<void> {
    await this.transaction(async client=>{
      // Serialize schema installation only, never game execution.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('coop-bench-schema-v1'))");
      await client.query(`CREATE TABLE IF NOT EXISTS coop_pg_episodes(
        id text PRIMARY KEY, revision bigint NOT NULL CHECK(revision>=0), data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        stored_bytes bigint NOT NULL DEFAULT 0 CHECK(stored_bytes>=0));
        CREATE INDEX IF NOT EXISTS coop_pg_episodes_status ON coop_pg_episodes((data->>'status'));
        CREATE TABLE IF NOT EXISTS coop_pg_evidence(
          episode_id text NOT NULL REFERENCES coop_pg_episodes(id),kind text NOT NULL,key text NOT NULL,value jsonb NOT NULL,
          stored_bytes bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
          PRIMARY KEY(episode_id,kind,key));
        CREATE INDEX IF NOT EXISTS coop_pg_evidence_episode_kind ON coop_pg_evidence(episode_id,kind,created_at,key);
        CREATE TABLE IF NOT EXISTS coop_pg_usage(category text PRIMARY KEY,bytes bigint NOT NULL DEFAULT 0 CHECK(bytes>=0));
        INSERT INTO coop_pg_usage(category) VALUES('game'),('messages'),('artifacts') ON CONFLICT DO NOTHING;
        CREATE TABLE IF NOT EXISTS coop_pg_streams(
          episode_id text NOT NULL REFERENCES coop_pg_episodes(id),player_id text NOT NULL,data jsonb NOT NULL DEFAULT '{}',
          PRIMARY KEY(episode_id,player_id));
        CREATE TABLE IF NOT EXISTS coop_pg_artifacts(
          id text PRIMARY KEY,episode_id text NOT NULL REFERENCES coop_pg_episodes(id),player_id text NOT NULL,request_id text NOT NULL,
          manifest_hash text NOT NULL,data jsonb NOT NULL,reserved_bytes bigint NOT NULL,
          UNIQUE(episode_id,player_id,request_id));
        CREATE TABLE IF NOT EXISTS coop_pg_chunks(
          artifact_id text NOT NULL REFERENCES coop_pg_artifacts(id),chunk_index integer NOT NULL CHECK(chunk_index>=0),data bytea NOT NULL,
          PRIMARY KEY(artifact_id,chunk_index));`);
    });
  }
  async transaction<T>(run:(client:PoolClient)=>Promise<T>):Promise<T> {
    const client=await this.pool.connect();
    try {await client.query('BEGIN');const value=await run(client);await client.query('COMMIT');return value;}
    catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally{client.release();}
  }
  async now(client:PgClient=this.pool):Promise<number> {
    return Number((await client.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now')).rows[0].now);
  }
  async row(id:string,client:PgClient=this.pool):Promise<StoredEpisode> {
    const row=(await client.query('SELECT id,revision,data FROM coop_pg_episodes WHERE id=$1',[id])).rows[0];
    check(row,'Unknown episode.','NOT_FOUND');return {...row,revision:Number(row.revision)};
  }
  async reserve(client:PoolClient,category:string,bytes:number,max:number):Promise<void> {
    if(bytes<=0)return;
    const changed=await client.query('UPDATE coop_pg_usage SET bytes=bytes+$2 WHERE category=$1 AND bytes+$2<=$3 RETURNING bytes',[category,bytes,max]);
    check(changed.rowCount===1,'Storage budget reached; all existing evidence is retained. Increase capacity to accept new writes.','RESOURCE_LIMIT');
  }
  async evidence(id:string,kind:string,key:string,client:PgClient=this.pool):Promise<JsonObject|undefined> {
    return (await client.query('SELECT value FROM coop_pg_evidence WHERE episode_id=$1 AND kind=$2 AND key=$3',[id,kind,key])).rows[0]?.value;
  }
  async records(id:string,kind:string,client:PgClient=this.pool):Promise<JsonObject[]> {
    return (await client.query('SELECT value FROM coop_pg_evidence WHERE episode_id=$1 AND kind=$2 ORDER BY key',[id,kind])).rows.map(row=>row.value);
  }
  async writeEvidence(client:PoolClient,id:string,writes:EvidenceWrite[],maxEpisode:number,maxTotal:number,allowOverflow=false):Promise<void> {
    let bytes=0;
    for(const row of writes) {
      const size=Buffer.byteLength(JSON.stringify(row.value))+128;
      const inserted=await client.query('INSERT INTO coop_pg_evidence(episode_id,kind,key,value,stored_bytes) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING key',[id,row.kind,row.key,row.value,size]);
      if(inserted.rowCount)bytes+=size;
    }
    if(!bytes)return;
    const changed=await client.query('UPDATE coop_pg_episodes SET stored_bytes=stored_bytes+$2 WHERE id=$1 AND ($4 OR stored_bytes+$2<=$3) RETURNING id',[id,bytes,maxEpisode,allowOverflow]);
    check(changed.rowCount===1,'Episode storage budget reached; existing history is retained.','RESOURCE_LIMIT');
    if(allowOverflow)await client.query("UPDATE coop_pg_usage SET bytes=bytes+$1 WHERE category='game'",[bytes]);
    else await this.reserve(client,'game',bytes,maxTotal);
  }
  async close():Promise<void> {if(this.ownsPool)await this.pool.end();}
}
