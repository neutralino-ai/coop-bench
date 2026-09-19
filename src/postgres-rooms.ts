import {randomBytes, randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {digest} from './authority.ts';
import {check, exactKeys, object} from './common.ts';
import type {PostgresAuthority} from './postgres-authority.ts';

const secret=()=>randomBytes(32).toString('base64url');
/** Membership transactions serialize on the room, never on a process-local owner. */
export class PostgresRooms {
  readonly authority:PostgresAuthority;
  constructor(authority:PostgresAuthority) {this.authority=authority;}
  async readySchema() {
    await this.authority.withTransaction(async db=>{
    await db.query("SELECT pg_advisory_xact_lock(hashtext('coop-room-schema-v1'))");
    await db.query(`CREATE TABLE IF NOT EXISTS coop_pg_rooms (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, game_id TEXT NOT NULL, options JSONB NOT NULL,
      status TEXT NOT NULL, roster_version INTEGER NOT NULL, host TEXT, invite_hash TEXT NOT NULL,
      expires_at DOUBLE PRECISION NOT NULL, episode_id TEXT UNIQUE, build TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp());
      CREATE TABLE IF NOT EXISTS coop_pg_room_members (
      room_id TEXT NOT NULL REFERENCES coop_pg_rooms(id), player_id TEXT NOT NULL, name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE, ready_version INTEGER, PRIMARY KEY(room_id,player_id));
      CREATE TABLE IF NOT EXISTS coop_pg_room_events (
      room_id TEXT NOT NULL REFERENCES coop_pg_rooms(id), seq INTEGER NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
      kind TEXT NOT NULL,payload JSONB NOT NULL,PRIMARY KEY(room_id,seq));`);
    });
  }
  private async row(db:PoolClient|PostgresAuthority['pool'],id:string,lock=false) {
    const r=await db.query(`SELECT *,extract(epoch FROM clock_timestamp())*1000 AS db_now FROM coop_pg_rooms WHERE id=$1${lock?' FOR UPDATE':''}`,[id]);
    check(r.rows[0],'Unknown room.','NOT_FOUND');return r.rows[0];
  }
  private lobby(row:any) {check(row.build===this.authority.build,'Room belongs to another engine build.','BUILD_MISMATCH');check(row.status==='waiting'&&Number(row.db_now)<row.expires_at,'Room already started or invitation expired.','ROOM_CLOSED');}
  private async member(db:any,id:string,token:string) {
    check(typeof token==='string'&&token.length>=24&&token.length<=256,'Membership credential required.','UNAUTHORIZED');
    const r=await db.query('SELECT * FROM coop_pg_room_members WHERE room_id=$1 AND token_hash=$2',[id,digest(token)]);
    check(r.rows[0],'Invalid membership credential.','UNAUTHORIZED');return r.rows[0];
  }
  private async event(db:PoolClient,id:string,kind:string,payload:any) {
    const n=Number((await db.query('SELECT count(*) AS n FROM coop_pg_room_events WHERE room_id=$1',[id])).rows[0].n);
    check(n<1000,'Room event budget reached; history is retained.','RESOURCE_LIMIT');
    await db.query('INSERT INTO coop_pg_room_events(room_id,seq,kind,payload) VALUES($1,$2,$3,$4)',[id,n,kind,JSON.stringify(payload)]);
  }
  private async snapshot(db:any,row:any,me?:string) {
    const members=(await db.query('SELECT player_id,name,ready_version FROM coop_pg_room_members WHERE room_id=$1 ORDER BY player_id',[row.id])).rows;
    const status=row.episode_id?await this.authority.episodeStatus(row.episode_id,db):null;
    return {roomId:row.id,gameId:row.game_id,...row.options,status:status??(row.status==='waiting'&&Number(row.db_now)>=row.expires_at?'expired':row.status),
      rosterVersion:row.roster_version,hostPlayerId:row.host,expiresAt:row.expires_at,episodeId:row.episode_id,playerId:me??null,
      members:members.map((p:any)=>({playerId:p.player_id,name:p.name,ready:p.ready_version===row.roster_version}))};
  }
  async create(owner:string,input:any) {
    exactKeys(input,['gameId','playerCount','scenarioId','config']);const game=this.authority.adapters.get(input.gameId);
    check(game?.decisionWindow,'Game does not support sessions.','INVALID_CONFIG');
    check(game.metadata.players.includes(input.playerCount)&&game.metadata.scenarios.some(s=>s.id===input.scenarioId),'Unsupported room setup.','INVALID_CONFIG');
    check(input.config===undefined||object(input.config),'Invalid game config.','INVALID_CONFIG');
    const id=randomUUID(),inviteToken=secret(),options={playerCount:input.playerCount,scenarioId:input.scenarioId,...(input.config?{config:input.config}:{})};
    return this.authority.withTransaction(async db=>{
      // This rare admin operation uses one database lock to make the global cap exact.
      await db.query("SELECT pg_advisory_xact_lock(hashtext('coop-room-cap'))");
      check(Number((await db.query('SELECT count(*) AS n FROM coop_pg_rooms')).rows[0].n)<1000,'Room storage limit reached. Existing rooms are retained.','RESOURCE_LIMIT');
      await db.query(`INSERT INTO coop_pg_rooms(id,owner,game_id,options,status,roster_version,invite_hash,expires_at,build)
        VALUES($1,$2,$3,$4,'waiting',1,$5,extract(epoch FROM clock_timestamp())*1000+600000,$6)`,[id,owner,input.gameId,JSON.stringify(options),digest(inviteToken),this.authority.build]);
      await this.event(db,id,'created',{owner,gameId:input.gameId,...options});return {...await this.snapshot(db,await this.row(db,id)),inviteToken};
    });
  }
  async list() {const rows=(await this.authority.pool.query('SELECT *,extract(epoch FROM clock_timestamp())*1000 AS db_now FROM coop_pg_rooms ORDER BY created_at DESC LIMIT 100')).rows;return {rooms:await Promise.all(rows.map(r=>this.snapshot(this.authority.pool,r)))};}
  async admin(id:string) {return this.snapshot(this.authority.pool,await this.row(this.authority.pool,id));}
  async observe(id:string,token:string) {const me=await this.member(this.authority.pool,id,token);return this.snapshot(this.authority.pool,await this.row(this.authority.pool,id),me.player_id);}
  async join(id:string,invite:string,input:any) {
    exactKeys(input,['name','playerToken']);check(typeof input.name==='string'&&input.name.trim().length>0&&input.name.length<=60&&!/[\x00-\x1f]/.test(input.name),'Use a short display name.','INVALID_REQUEST');
    check(typeof input.playerToken==='string'&&/^[A-Za-z0-9_-]{43,128}$/.test(input.playerToken),'Generate a private membership token with at least 32 random bytes.','INVALID_REQUEST');
    return this.authority.withTransaction(async db=>{
      const row=await this.row(db,id,true),hash=digest(input.playerToken),prior=(await db.query('SELECT player_id FROM coop_pg_room_members WHERE room_id=$1 AND token_hash=$2',[id,hash])).rows[0];
      if(prior)return this.snapshot(db,row,prior.player_id);
      this.lobby(row);check(typeof invite==='string'&&digest(invite)===row.invite_hash,'Invalid invitation.','UNAUTHORIZED');
      const members=(await db.query('SELECT player_id FROM coop_pg_room_members WHERE room_id=$1',[id])).rows;
      const player=Array.from({length:row.options.playerCount},(_,i)=>`p${i+1}`).find(p=>!members.some(m=>m.player_id===p));check(player,'Room is full.','ROOM_FULL');
      await db.query('INSERT INTO coop_pg_room_members(room_id,player_id,name,token_hash) VALUES($1,$2,$3,$4)',[id,player,input.name.trim(),hash]);
      await db.query('UPDATE coop_pg_rooms SET roster_version=roster_version+1,host=COALESCE(host,$2) WHERE id=$1',[id,player]);
      await this.event(db,id,'joined',{playerId:player,name:input.name.trim()});return this.snapshot(db,await this.row(db,id),player);
    });
  }
  async ready(id:string,token:string,input:any) {
    exactKeys(input,['rosterVersion','ready']);check(typeof input.ready==='boolean','ready must be boolean.','INVALID_REQUEST');
    return this.authority.withTransaction(async db=>{
      const row=await this.row(db,id,true),me=await this.member(db,id,token);this.lobby(row);
      check(input.rosterVersion===row.roster_version,'Roster changed; review it and ready again.','STALE_ROSTER');
      if(me.ready_version!==(input.ready?row.roster_version:null)){
        await db.query('UPDATE coop_pg_room_members SET ready_version=$3 WHERE room_id=$1 AND player_id=$2',[id,me.player_id,input.ready?row.roster_version:null]);
        await this.event(db,id,'ready',{playerId:me.player_id,ready:input.ready,rosterVersion:row.roster_version});
      }return this.snapshot(db,row,me.player_id);
    });
  }
  async start(id:string,token?:string) {
    return this.authority.withTransaction(async db=>{
      const row=await this.row(db,id,true),me=token!==undefined?await this.member(db,id,token):undefined;
      if(me)check(row.host===me.player_id,'Only the host may start.','FORBIDDEN');
      if(row.episode_id)return this.snapshot(db,row,me?.player_id);this.lobby(row);
      const members=(await db.query('SELECT * FROM coop_pg_room_members WHERE room_id=$1',[id])).rows;
      check(members.length===row.options.playerCount&&members.every(m=>m.ready_version===row.roster_version),'All seats must confirm the current roster.','NOT_READY');
      const created=await this.authority.create(row.game_id,row.options,db);
      for(const m of members)await this.authority.bindSeatTokenHash(created.episodeId,m.player_id,m.token_hash,db);
      await this.authority.enableSessionBudget(created.episodeId,db);
      await db.query("UPDATE coop_pg_rooms SET status='active',episode_id=$2 WHERE id=$1",[id,created.episodeId]);
      await this.event(db,id,'started',{episodeId:created.episodeId,rosterVersion:row.roster_version});return this.snapshot(db,await this.row(db,id),me?.player_id);
    });
  }
  async remove(id:string,target:string,token?:string,leave=false) {
    return this.authority.withTransaction(async db=>{
      const row=await this.row(db,id,true),me=token!==undefined?await this.member(db,id,token):undefined;this.lobby(row);
      if(me)check(leave?target===me.player_id:row.host===me.player_id,'Only the host can remove another player.','FORBIDDEN');
      check(typeof target==='string'&&(await db.query('DELETE FROM coop_pg_room_members WHERE room_id=$1 AND player_id=$2 RETURNING player_id',[id,target])).rowCount,'Unknown member.','NOT_FOUND');
      const next=(await db.query('SELECT player_id FROM coop_pg_room_members WHERE room_id=$1 ORDER BY player_id LIMIT 1',[id])).rows[0]?.player_id??null;
      await db.query('UPDATE coop_pg_rooms SET roster_version=roster_version+1,host=$2,invite_hash=$3 WHERE id=$1',[id,row.host===target?next:row.host,digest(secret())]);
      await this.event(db,id,leave?'left':'kicked',{playerId:target,by:me?.player_id??'operator'});return this.snapshot(db,await this.row(db,id),me?.player_id===target?undefined:me?.player_id);
    });
  }
  async invite(id:string,token?:string) {
    return this.authority.withTransaction(async db=>{
      const row=await this.row(db,id,true);this.lobby(row);if(token!==undefined)check((await this.member(db,id,token)).player_id===row.host,'Only the host may rotate invitations.','FORBIDDEN');
      const inviteToken=secret();await db.query('UPDATE coop_pg_rooms SET invite_hash=$2 WHERE id=$1',[id,digest(inviteToken)]);
      await this.event(db,id,'invitation_rotated',{});return {...await this.snapshot(db,row),inviteToken};
    });
  }
}
