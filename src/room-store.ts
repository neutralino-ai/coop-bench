import { randomBytes, randomUUID } from 'node:crypto';
import { Authority, digest } from './authority.ts';
import { check, exactKeys, object } from './common.ts';

const secret=()=>randomBytes(32).toString('base64url');
/** Pre-deal membership. No game state, seed or other seat credential is exposed. */
export class RoomStore {
  authority:Authority;
  constructor(authority:Authority) {
    this.authority=authority;
    authority.db.exec(`CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,owner TEXT NOT NULL,game_id TEXT NOT NULL,options TEXT NOT NULL,
      status TEXT NOT NULL,roster_version INTEGER NOT NULL,host TEXT,invite_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,episode_id TEXT UNIQUE,build TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS room_members(room_id TEXT NOT NULL REFERENCES rooms(id),player_id TEXT NOT NULL,name TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,
        ready_version INTEGER,PRIMARY KEY(room_id,player_id));
      CREATE TABLE IF NOT EXISTS room_events(room_id TEXT NOT NULL REFERENCES rooms(id),seq INTEGER NOT NULL,at INTEGER NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(room_id,seq));`);
  }
  private row(id:string):any {
    const row=this.authority.db.prepare('SELECT * FROM rooms WHERE id=?').get(id);check(row,'Unknown room.','NOT_FOUND');return row;
  }
  private lobby(row:any):void {
    check(row.build===this.authority.build,'Room belongs to another engine build.','BUILD_MISMATCH');
    check(row.status==='waiting'&&this.authority.clock()<row.expires_at,'Room already started or invitation expired.','ROOM_CLOSED');
  }
  private event(id:string,kind:string,payload:unknown):void {
    const n=Number(this.authority.db.prepare('SELECT COUNT(*) AS n FROM room_events WHERE room_id=?').get(id)!.n);
    check(n<1000,'Room event budget reached.','RESOURCE_LIMIT');
    this.authority.db.prepare('INSERT INTO room_events VALUES(?,?,?,?,?)').run(id,n,this.authority.clock(),kind,JSON.stringify(payload));
  }
  private member(id:string,token:string):any {
    check(typeof token==='string'&&token.length>=24,'Membership credential required.','UNAUTHORIZED');
    const p=this.authority.db.prepare('SELECT * FROM room_members WHERE room_id=? AND token_hash=?').get(id,digest(token));
    check(p,'Invalid membership credential.','UNAUTHORIZED');return p;
  }
  private snapshot(row:any,me?:string):any {
    const members=this.authority.db.prepare('SELECT player_id,name,ready_version FROM room_members WHERE room_id=? ORDER BY player_id').all(row.id);
    const episode=row.episode_id?this.authority.db.prepare('SELECT status FROM episodes WHERE id=?').get(row.episode_id):null;
    return {roomId:row.id,gameId:row.game_id,...JSON.parse(row.options),status:episode?.status??(row.status==='waiting'&&this.authority.clock()>=row.expires_at?'expired':row.status),
      rosterVersion:row.roster_version,hostPlayerId:row.host,expiresAt:row.expires_at,episodeId:row.episode_id,playerId:me??null,
      members:members.map(p=>({playerId:p.player_id,name:p.name,ready:p.ready_version===row.roster_version}))};
  }
  create(owner:string,input:any):any {
    exactKeys(input,['gameId','playerCount','scenarioId','config']);
    const game=this.authority.adapters.get(input.gameId);check(game?.decisionWindow,'Game does not support sessions.','INVALID_CONFIG');
    check(game.metadata.players.includes(input.playerCount)&&game.metadata.scenarios.some(s=>s.id===input.scenarioId),'Unsupported room setup.','INVALID_CONFIG');
    check(input.config===undefined||object(input.config),'Invalid game config.','INVALID_CONFIG');
    const id=randomUUID(),inviteToken=secret(),options={playerCount:input.playerCount,scenarioId:input.scenarioId,...(input.config?{config:input.config}:{})};
    return this.authority.atomic(()=>{
      check(Number(this.authority.db.prepare('SELECT COUNT(*) AS n FROM rooms').get()!.n)<1000,'Room storage limit reached; existing history is retained.','RESOURCE_LIMIT');
      this.authority.db.prepare('INSERT INTO rooms VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,input.gameId,JSON.stringify(options),'waiting',1,null,digest(inviteToken),this.authority.clock()+10*60*1000,null,this.authority.build);
      this.event(id,'created',{owner,gameId:input.gameId,...options});return {...this.snapshot(this.row(id)),inviteToken};
    });
  }
  list():any {return {rooms:this.authority.db.prepare('SELECT * FROM rooms ORDER BY rowid DESC LIMIT 100').all().map(r=>this.snapshot(r))};}
  admin(id:string):any {return this.snapshot(this.row(id));}
  observe(id:string,token:string):any {return this.snapshot(this.row(id),this.member(id,token).player_id);}
  join(id:string,invite:string,input:any):any {
    exactKeys(input,['name','playerToken']);
    check(typeof input.name==='string'&&input.name.trim().length>0&&input.name.length<=60&&!/[\x00-\x1f]/.test(input.name),'Use a short display name.','INVALID_REQUEST');
    check(typeof input.playerToken==='string'&&/^[A-Za-z0-9_-]{43,128}$/.test(input.playerToken),'Generate a private random membership token with at least 32 random bytes.','INVALID_REQUEST');
    return this.authority.atomic(()=>{
      const row=this.row(id),hash=digest(input.playerToken);
      const prior=this.authority.db.prepare('SELECT player_id FROM room_members WHERE room_id=? AND token_hash=?').get(id,hash);
      if(prior)return this.snapshot(row,prior.player_id as string);
      this.lobby(row);check(digest(invite)===row.invite_hash,'Invalid invitation.','UNAUTHORIZED');
      const members=this.authority.db.prepare('SELECT player_id FROM room_members WHERE room_id=?').all(id),count=JSON.parse(row.options).playerCount;
      const player=Array.from({length:count},(_,i)=>`p${i+1}`).find(p=>!members.some(m=>m.player_id===p));check(player,'Room is full.','ROOM_FULL');
      this.authority.db.prepare('INSERT INTO room_members VALUES(?,?,?,?,NULL)').run(id,player,input.name.trim(),hash);
      this.authority.db.prepare('UPDATE rooms SET roster_version=roster_version+1,host=COALESCE(host,?) WHERE id=?').run(player,id);
      this.event(id,'joined',{playerId:player,name:input.name.trim()});return this.snapshot(this.row(id),player);
    });
  }
  ready(id:string,token:string,input:any):any {
    exactKeys(input,['rosterVersion','ready']);check(typeof input.ready==='boolean','ready must be boolean.','INVALID_REQUEST');
    return this.authority.atomic(()=>{
      const row=this.row(id),me=this.member(id,token);this.lobby(row);
      check(input.rosterVersion===row.roster_version,'Roster changed; review it and ready again.','STALE_ROSTER');
      if(me.ready_version!==(input.ready?row.roster_version:null)){
        this.authority.db.prepare('UPDATE room_members SET ready_version=? WHERE room_id=? AND player_id=?').run(input.ready?row.roster_version:null,id,me.player_id);
        this.event(id,'ready',{playerId:me.player_id,ready:input.ready,rosterVersion:row.roster_version});
      }
      return this.snapshot(row,me.player_id);
    });
  }
  start(id:string,token?:string):any {
    return this.authority.atomic(()=>{
      const row=this.row(id),me=token!==undefined?this.member(id,token):undefined;
      if(me)check(row.host===me.player_id,'Only the host may start.','FORBIDDEN');
      if(row.episode_id)return this.snapshot(row,me?.player_id);
      this.lobby(row);
      const members=this.authority.db.prepare('SELECT * FROM room_members WHERE room_id=?').all(id),options=JSON.parse(row.options);
      check(members.length===options.playerCount&&members.every(m=>m.ready_version===row.roster_version),'All seats must confirm the current roster.','NOT_READY');
      const created=this.authority.create(row.game_id,options);
      for(const m of members)this.authority.db.prepare('UPDATE seats SET token_hash=? WHERE episode_id=? AND player_id=?').run(m.token_hash,created.episodeId,m.player_id);
      this.authority.enableSessionBudget(created.episodeId);
      this.authority.db.prepare("UPDATE rooms SET status='active',episode_id=? WHERE id=?").run(created.episodeId,id);
      this.event(id,'started',{episodeId:created.episodeId,rosterVersion:row.roster_version});return this.snapshot(this.row(id),me?.player_id);
    });
  }
  remove(id:string,target:string,token?:string,leave=false):any {
    return this.authority.atomic(()=>{
      const row=this.row(id),me=token!==undefined?this.member(id,token):undefined;this.lobby(row);
      if(me)check(leave?target===me.player_id:row.host===me.player_id,'Only the host can remove another player.','FORBIDDEN');
      check(typeof target==='string'&&this.authority.db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND player_id=?').get(id,target),'Unknown member.','NOT_FOUND');
      this.authority.db.prepare('DELETE FROM room_members WHERE room_id=? AND player_id=?').run(id,target);
      const next=this.authority.db.prepare('SELECT player_id FROM room_members WHERE room_id=? ORDER BY player_id LIMIT 1').get(id)?.player_id??null;
      // Revoke old invitations when kicking: otherwise the removed participant can immediately rejoin.
      this.authority.db.prepare('UPDATE rooms SET roster_version=roster_version+1,host=?,invite_hash=? WHERE id=?').run(row.host===target?next:row.host,digest(secret()),id);
      this.event(id,leave?'left':'kicked',{playerId:target,by:me?.player_id??'operator'});return this.snapshot(this.row(id),me?.player_id===target?undefined:me?.player_id);
    });
  }
  invite(id:string,token?:string):any {
    return this.authority.atomic(()=>{
      const row=this.row(id);this.lobby(row);if(token!==undefined)check(this.member(id,token).player_id===row.host,'Only the host may rotate invitations.','FORBIDDEN');
      const inviteToken=secret();this.authority.db.prepare('UPDATE rooms SET invite_hash=? WHERE id=?').run(digest(inviteToken),id);
      this.event(id,'invitation_rotated',{});return {...this.snapshot(row),inviteToken};
    });
  }
}
