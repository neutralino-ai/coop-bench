import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {tokenHash,validateAccessUsers,type AccessUser,type AccessPermission} from './access-control.ts';
import {HUMAN_PASSWORD_POLICY,HUMAN_SESSION_SECONDS,KDF,KdfQueue,passwordShape} from './human-auth.ts';
import {check,object,RuleError} from './common.ts';

const allowed={operator:['rollout:read','rollout:annotate','episode:create','episode:truncate','episode:export','episode:replay'],auditor:['rollout:read','rollout:annotate']};
const denied=()=>new RuleError('UNAUTHORIZED','Login or authentication failed.');
/** Users, passwords, sessions and login budgets are shared across every API replica. */
export class PostgresAuth {
  private queue=new KdfQueue();private dummy=randomBytes(16);private closed=false;
  readonly pool:Pool;
  constructor(pool:Pool) {this.pool=pool;}
  async ready(users:AccessUser[]=[]) {
    validateAccessUsers({version:1,users});
    await this.transaction(async db=>{
    await db.query("SELECT pg_advisory_xact_lock(hashtext('coop-auth-schema-v1'))");
    await db.query(`CREATE TABLE IF NOT EXISTS coop_pg_users(id TEXT PRIMARY KEY,role TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,disabled BOOLEAN NOT NULL,expires_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS coop_pg_passwords(user_id TEXT PRIMARY KEY REFERENCES coop_pg_users(id),binding TEXT NOT NULL,salt BYTEA NOT NULL,password_hash BYTEA NOT NULL,revision TEXT NOT NULL,kdf_version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS coop_pg_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES coop_pg_users(id),binding TEXT NOT NULL,password_revision TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
      CREATE INDEX IF NOT EXISTS coop_pg_session_user ON coop_pg_sessions(user_id,created_at);
      CREATE TABLE IF NOT EXISTS coop_pg_auth_budget(key TEXT PRIMARY KEY,minute BIGINT NOT NULL,n INTEGER NOT NULL);`);
    // Bootstrap only; restarting an instance must not restore a revoked credential.
    for(const u of users)await db.query('INSERT INTO coop_pg_users VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[u.id,u.role,u.tokenHash,u.disabled,u.expiresAt??null]);
    });
  }
  status(){return {enabled:!this.closed,passwordLoginAvailable:!this.closed,sessionTtlSeconds:HUMAN_SESSION_SECONDS,passwordPolicy:HUMAN_PASSWORD_POLICY};}
  private async transaction<T>(fn:(db:PoolClient)=>Promise<T>):Promise<T> {const db=await this.pool.connect();try{await db.query('BEGIN');const out=await fn(db);await db.query('COMMIT');return out;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
  private async budget(user:string) {
    for(const [key,limit] of [['global',30],[tokenHash(user),10]] as const){
      const r=await this.pool.query(`INSERT INTO coop_pg_auth_budget(key,minute,n) VALUES($1,floor(extract(epoch FROM clock_timestamp())/60)::bigint,1)
        ON CONFLICT(key) DO UPDATE SET minute=excluded.minute,n=CASE WHEN coop_pg_auth_budget.minute=excluded.minute THEN coop_pg_auth_budget.n+1 ELSE 1 END RETURNING n`,[key]);
      check(r.rows[0].n<=limit,'Authentication rate exceeded; retry later.','RATE_LIMITED');
    }
    await this.pool.query("DELETE FROM coop_pg_auth_budget WHERE key<>'global' AND minute < floor(extract(epoch FROM clock_timestamp())/60)-5");
  }
  private async authenticate(db:any,token:string,permission:AccessPermission='rollout:read') {
    check(!this.closed,'Authentication unavailable.','FORBIDDEN');
    if(typeof token!=='string'||token.length<24||token.length>256)throw denied();
    const personal=(await db.query('SELECT * FROM coop_pg_users WHERE token_hash=$1 AND NOT disabled AND (expires_at IS NULL OR expires_at>clock_timestamp())',[tokenHash(token)])).rows[0];
    let user=personal,authentication='personal-token',sessionExpiresAt;
    if(!user){
      const s=(await db.query(`SELECT u.*,s.expires_at AS session_expires FROM coop_pg_sessions s JOIN coop_pg_users u ON u.id=s.user_id
        JOIN coop_pg_passwords p ON p.user_id=u.id WHERE s.token_hash=$1 AND NOT u.disabled AND (u.expires_at IS NULL OR u.expires_at>clock_timestamp())
        AND s.expires_at>clock_timestamp() AND s.binding=u.token_hash AND p.binding=u.token_hash AND p.revision=s.password_revision`,[tokenHash(token)])).rows[0];
      if(!s)throw denied();user=s;authentication='password-session';sessionExpiresAt=s.session_expires.toISOString();
    }
    check(allowed[user.role as keyof typeof allowed]?.includes(permission),'Credential does not allow this operation.','FORBIDDEN');
    return {user,principal:{id:user.id,role:user.role,source:user.id},authentication,sessionExpiresAt};
  }
  async authorize(token:string,_admin:string,permission:AccessPermission) {return (await this.authenticate(this.pool,token,permission)).principal;}
  async account(token:string,_admin:string) {const a=await this.authenticate(this.pool,token),p=(await this.pool.query('SELECT binding FROM coop_pg_passwords WHERE user_id=$1',[a.user.id])).rows[0];return {userId:a.user.id,role:a.user.role,passwordConfigured:p?.binding===a.user.token_hash,authentication:a.authentication,...(a.sessionExpiresAt?{sessionExpiresAt:a.sessionExpiresAt}:{})};}
  private async issue(db:PoolClient,user:any,revision:string) {
    await db.query('DELETE FROM coop_pg_sessions WHERE expires_at<=clock_timestamp()');
    await db.query('DELETE FROM coop_pg_sessions WHERE token_hash IN (SELECT token_hash FROM coop_pg_sessions WHERE user_id=$1 ORDER BY created_at DESC,token_hash DESC OFFSET 7)',[user.id]);
    const token='hs1_'+randomBytes(32).toString('base64url');
    const r=await db.query(`INSERT INTO coop_pg_sessions VALUES($1,$2,$3,$4,clock_timestamp(),LEAST(clock_timestamp()+$5*interval '1 second',COALESCE($6::timestamptz,'infinity'))) RETURNING expires_at`,[tokenHash(token),user.id,user.token_hash,revision,HUMAN_SESSION_SECONDS,user.expires_at]);
    return {token,expiresAt:r.rows[0].expires_at.toISOString(),identity:{id:user.id,role:user.role},passwordConfigured:true};
  }
  private valid(p:any) {check(p.kdf_version===KDF.version&&p.salt?.length===16&&p.password_hash?.length===64,'Authentication configuration unavailable.','INVALID_CONFIG');}
  async login(input:unknown) {
    check(object(input)&&Object.keys(input).every(k=>['userId','password'].includes(k))&&typeof input.userId==='string'&&input.userId.length>0&&input.userId.length<=64&&passwordShape(input.password),'Invalid authentication request.','INVALID_REQUEST');
    await this.budget(input.userId);const p=(await this.pool.query(`SELECT p.*,u.token_hash FROM coop_pg_passwords p JOIN coop_pg_users u ON u.id=p.user_id WHERE u.id=$1 AND NOT u.disabled AND (u.expires_at IS NULL OR u.expires_at>clock_timestamp()) AND p.binding=u.token_hash`,[input.userId])).rows[0];
    if(p)this.valid(p);const actual=await this.queue.derive(input.password,p?.salt??this.dummy),matches=timingSafeEqual(actual,p?.password_hash??Buffer.alloc(64));if(!p||!matches)throw denied();
    return this.transaction(async db=>{
      const u=(await db.query('SELECT * FROM coop_pg_users WHERE id=$1 AND NOT disabled AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR UPDATE',[input.userId])).rows[0];
      const latest=(await db.query('SELECT revision FROM coop_pg_passwords WHERE user_id=$1',[input.userId])).rows[0];
      if(!u||u.token_hash!==p.binding||latest?.revision!==p.revision)throw denied();return this.issue(db,u,p.revision);
    });
  }
  async setPassword(token:string,_admin:string,input:unknown) {
    check(object(input)&&Object.keys(input).every(k=>['password','currentPassword'].includes(k))&&passwordShape(input.password,true)&&(input.currentPassword===undefined||passwordShape(input.currentPassword)),'Invalid authentication request.','INVALID_REQUEST');
    const a=await this.authenticate(this.pool,token);await this.budget(a.user.id);
    const before=(await this.pool.query('SELECT * FROM coop_pg_passwords WHERE user_id=$1',[a.user.id])).rows[0],configured=before?.binding===a.user.token_hash;
    if(configured){this.valid(before);const current=await this.queue.derive(input.currentPassword??'',before.salt);if(!input.currentPassword||!timingSafeEqual(current,before.password_hash))throw denied();}
    else if(a.authentication!=='personal-token')throw denied();
    const salt=randomBytes(16),hash=await this.queue.derive(input.password,salt);
    return this.transaction(async db=>{
      await db.query('SELECT id FROM coop_pg_users WHERE id=$1 FOR UPDATE',[a.user.id]);const latestAuth=await this.authenticate(db,token),latest=(await db.query('SELECT revision FROM coop_pg_passwords WHERE user_id=$1',[a.user.id])).rows[0];
      if(latestAuth.user.token_hash!==a.user.token_hash)throw denied();check(latest?.revision===before?.revision,'Password changed concurrently; sign in again.','AUTH_CONFLICT');
      const revision=randomUUID();await db.query(`INSERT INTO coop_pg_passwords(user_id,binding,salt,password_hash,revision) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(user_id) DO UPDATE SET binding=excluded.binding,salt=excluded.salt,password_hash=excluded.password_hash,revision=excluded.revision,kdf_version=1`,[a.user.id,a.user.token_hash,salt,hash,revision]);
      await db.query('DELETE FROM coop_pg_sessions WHERE user_id=$1',[a.user.id]);return this.issue(db,latestAuth.user,revision);
    });
  }
  async logout(token:string,_admin:string) {const a=await this.authenticate(this.pool,token);if(a.authentication==='password-session')await this.pool.query('DELETE FROM coop_pg_sessions WHERE token_hash=$1',[tokenHash(token)]);return {loggedOut:true};}
  async close(){this.closed=true;await this.queue.close();}
}
