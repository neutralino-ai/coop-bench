import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AccessControl, tokenHash, type AccessPermission, type AccessPrincipal, type AccessUser } from './access-control.ts';
import { check, object, RuleError } from './common.ts';

// Versioned, fixed cost. Stored values are validated before allocating memory.
export const KDF=Object.freeze({version:1,N:65536,r:8,p:2,keyLength:64,maxmem:128*1024*1024});
export const HUMAN_SESSION_SECONDS=7*24*60*60;
export const HUMAN_PASSWORD_POLICY=Object.freeze({minLength:12,maxLength:128,maxBytes:512});
export interface HumanAuthOptions {
  now?:()=>number;
  rate?:Partial<{globalBurst:number;globalPerMinute:number;userBurst:number;userPerMinute:number}>;
}
interface PasswordRow {user_id:string;binding:string;salt:Uint8Array;password_hash:Uint8Array;kdf_version:number;kdf_n:number;kdf_r:number;kdf_p:number;revision:string;updated_at:number;}
interface SessionRow {token_hash:string;user_id:string;binding:string;password_revision:string;created_at:number;expires_at:number;}
interface Authentication {principal:AccessPrincipal;binding:string;authentication:'personal-token'|'password-session';sessionExpiresAt?:string;}
export interface HumanLogin {token:string;expiresAt:string;identity:{id:string;role:string};passwordConfigured:true;}
const denied=()=>new RuleError('UNAUTHORIZED','Login or authentication failed.');
const unavailable=()=>new RuleError('FORBIDDEN','Password authentication is unavailable.');
function inputValid(condition:unknown):asserts condition {check(condition,'Invalid authentication request.','INVALID_REQUEST');}
export function passwordShape(value:unknown,newPassword=false):value is string {
  if(typeof value!=='string'||!value.isWellFormed()||value.length>256||Buffer.byteLength(value)>HUMAN_PASSWORD_POLICY.maxBytes)return false;
  const length=Array.from(value).length;
  return length>=(newPassword?HUMAN_PASSWORD_POLICY.minLength:1)&&length<=HUMAN_PASSWORD_POLICY.maxLength&&(!newPassword||value.trim().length>0);
}
function same(left:string,right:string):boolean {const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);}

/** At most two 64 MiB KDF jobs and four queued passwords; no unbounded work list. */
export class KdfQueue {
  private running=0;
  private closed=false;
  private jobs:{start:()=>void;reject:(error:Error)=>void}[]=[];
  private idle:(()=>void)[]=[];
  derive(password:string,salt:Uint8Array):Promise<Buffer> {
    if(this.closed)return Promise.reject(unavailable());
    if(this.running>=2&&this.jobs.length>=4)return Promise.reject(new RuleError('RATE_LIMITED','Authentication is busy; retry later.'));
    return new Promise((resolve,reject)=>{
      const start=()=>{
        this.running++;
        const finish=(error:Error|null,key?:Buffer)=>{
          this.running--;
          if(this.closed)reject(unavailable());else if(error)reject(new RuleError('INTERNAL','Authentication operation failed.'));else resolve(key!);
          if(!this.closed)this.jobs.shift()?.start();
          if(!this.running){for(const done of this.idle.splice(0))done();}
        };
        try{scrypt(password,salt,KDF.keyLength,{N:KDF.N,r:KDF.r,p:KDF.p,maxmem:KDF.maxmem},finish);}
        catch{finish(new Error('KDF failed'));}
      };
      if(this.running<2)start();else this.jobs.push({start,reject});
    });
  }
  async close():Promise<void> {
    this.closed=true;for(const job of this.jobs.splice(0))job.reject(unavailable());
    if(this.running)await new Promise<void>(resolve=>this.idle.push(resolve));
  }
}

class AuthBudget {
  private buckets=new Map<string,{tokens:number;at:number}>();
  private policy:{globalBurst:number;globalPerMinute:number;userBurst:number;userPerMinute:number};
  private now:()=>number;
  constructor(now:()=>number,rate:HumanAuthOptions['rate']) {
    this.now=now;
    this.policy={globalBurst:12,globalPerMinute:30,userBurst:5,userPerMinute:10,...rate};
    for(const value of Object.values(this.policy))check(Number.isFinite(value)&&value>0,'Invalid authentication limits.','INVALID_CONFIG');
  }
  private spend(key:string,burst:number,minute:number):void {
    const at=this.now(),previous=this.buckets.get(key)??{tokens:burst,at};
    previous.tokens=Math.min(burst,previous.tokens+Math.max(0,at-previous.at)*minute/60000);previous.at=at;
    this.buckets.delete(key);this.buckets.set(key,previous);
    if(this.buckets.size>256){const oldest=[...this.buckets.keys()].find(id=>id!=='global');if(oldest)this.buckets.delete(oldest);}
    check(previous.tokens>=1,'Authentication rate exceeded; retry later.','RATE_LIMITED');previous.tokens--;
  }
  attempt(id:string):void {this.spend('global',this.policy.globalBurst,this.policy.globalPerMinute);this.spend(tokenHash(id),this.policy.userBurst,this.policy.userPerMinute);}
}

export class HumanAuth {
  private readonly db:DatabaseSync;
  private readonly now:()=>number;
  private readonly queue=new KdfQueue();
  private readonly budget:AuthBudget;
  private readonly dummySalt=randomBytes(16);
  private closed=false;
  private closing?:Promise<void>;
  private readonly access:AccessControl;
  constructor(path:string,access:AccessControl,options:HumanAuthOptions={}) {
    this.access=access;
    this.now=options.now??Date.now;this.budget=new AuthBudget(this.now,options.rate);
    check(access.humanPasswordEnabled,'Password authentication is unavailable.','INVALID_CONFIG');
    if(path!==':memory:'){
      mkdirSync(dirname(path),{recursive:true,mode:0o700});
      if(!existsSync(path)){const descriptor=openSync(path,'wx',0o600);closeSync(descriptor);}
      check(lstatSync(path).isFile()&&!lstatSync(path).isSymbolicLink(),'Invalid authentication database.','INVALID_CONFIG');
      if(process.platform!=='win32')chmodSync(path,0o600);
    }
    this.db=new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000;');
      const version=Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
      check(version===0||version===1,'Unsupported authentication database version.','INVALID_CONFIG');
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS passwords(user_id TEXT PRIMARY KEY,binding TEXT NOT NULL,salt BLOB NOT NULL,password_hash BLOB NOT NULL,kdf_version INTEGER NOT NULL,kdf_n INTEGER NOT NULL,kdf_r INTEGER NOT NULL,kdf_p INTEGER NOT NULL,revision TEXT NOT NULL,updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES passwords(user_id) ON DELETE CASCADE,binding TEXT NOT NULL,password_revision TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id,created_at);
        CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
        PRAGMA user_version=1; COMMIT;`);
    }catch(error){this.db.close();throw error;}
  }
  status(){const enabled=!this.closed&&this.access.humanPasswordEnabled;return {enabled,passwordLoginAvailable:enabled,sessionTtlSeconds:HUMAN_SESSION_SECONDS,passwordPolicy:HUMAN_PASSWORD_POLICY};}
  private ready():void {if(this.closed||!this.access.humanPasswordEnabled)throw unavailable();}
  private row(id:string):PasswordRow|undefined {return this.db.prepare('SELECT * FROM passwords WHERE user_id=?').get(id) as unknown as PasswordRow|undefined;}
  private validRecord(row:PasswordRow):void {
    check(row.kdf_version===KDF.version&&row.kdf_n===KDF.N&&row.kdf_r===KDF.r&&row.kdf_p===KDF.p&&row.salt instanceof Uint8Array&&row.salt.length===16&&row.password_hash instanceof Uint8Array&&row.password_hash.length===KDF.keyLength,'Authentication configuration is unavailable.','INVALID_CONFIG');
  }
  private authenticate(token:string,adminToken:string,permission:AccessPermission='rollout:read'):Authentication {
    this.ready();
    const personal=(principal:AccessPrincipal):Authentication=>{
      if(principal.role==='coordinator')throw unavailable();
      const user=this.access.activeUser(principal.id,this.now());if(!user)throw denied();
      return {principal,binding:user.tokenHash,authentication:'personal-token'};
    };
    if(token.startsWith('hs1_')){
      // Existing randomly generated personal tokens may share this prefix.
      // Registered personal credentials retain their semantics, even on a collision.
      try{return personal(this.access.authorize(token,adminToken,permission));}
      catch(error){if(!(error instanceof RuleError)||error.code!=='UNAUTHORIZED')throw error;}
      if(!/^hs1_[A-Za-z0-9_-]{43}$/.test(token))throw denied();
      const row=this.db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(tokenHash(token)) as unknown as SessionRow|undefined;
      if(!row||row.expires_at<=this.now())throw denied();
      const password=this.row(row.user_id);
      if(!password||password.revision!==row.password_revision||!same(password.binding,row.binding))throw denied();
      const principal=this.access.authorizeUser(row.user_id,permission,row.binding,this.now());
      return {principal,binding:row.binding,authentication:'password-session',sessionExpiresAt:new Date(row.expires_at).toISOString()};
    }
    return personal(this.access.authorize(token,adminToken,permission));
  }
  /** Null means an original personal/coordinator token; invalid session tokens never fall back. */
  authorize(token:string,adminToken:string,permission:AccessPermission):AccessPrincipal|null {
    return token.startsWith('hs1_')?this.authenticate(token,adminToken,permission).principal:null;
  }
  account(token:string,adminToken:string) {
    const auth=this.authenticate(token,adminToken),row=this.row(auth.principal.id);
    return {userId:auth.principal.id,role:auth.principal.role,passwordConfigured:!!row&&same(row.binding,auth.binding),authentication:auth.authentication,...(auth.sessionExpiresAt?{sessionExpiresAt:auth.sessionExpiresAt}:{})};
  }
  private transaction<T>(work:()=>T):T {
    this.ready();this.db.exec('BEGIN IMMEDIATE');
    try{const result=work();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  private issue(user:AccessUser,revision:string):HumanLogin {
    const created=this.now(),expires=Math.min(created+HUMAN_SESSION_SECONDS*1000,user.expiresAt?Date.parse(user.expiresAt):Infinity);
    check(expires>created,'Login or authentication failed.','UNAUTHORIZED');
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(created);
    // Bound persistent session storage to eight sessions per account.
    const previous=this.db.prepare('SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC,token_hash DESC').all(user.id);
    for(const row of previous.slice(7))this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(row.token_hash);
    const token='hs1_'+randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO sessions(token_hash,user_id,binding,password_revision,created_at,expires_at) VALUES(?,?,?,?,?,?)').run(tokenHash(token),user.id,user.tokenHash,revision,created,expires);
    return {token,expiresAt:new Date(expires).toISOString(),identity:{id:user.id,role:user.role},passwordConfigured:true};
  }
  async login(input:unknown):Promise<HumanLogin> {
    this.ready();inputValid(object(input)&&Object.keys(input).every(key=>['userId','password'].includes(key))&&typeof input.userId==='string'&&input.userId.length>0&&input.userId.length<=64&&passwordShape(input.password));
    const {userId,password}=input as {userId:string;password:string};this.budget.attempt(userId);
    const user=this.access.activeUser(userId,this.now()),candidate=this.row(userId),row=user&&candidate&&same(candidate.binding,user.tokenHash)?candidate:undefined;
    if(row)this.validRecord(row);
    const actual=await this.queue.derive(password,row?.salt??this.dummySalt);this.ready();
    // Missing, disabled, expired and unconfigured accounts perform the same KDF.
    const matches=timingSafeEqual(actual,row?Buffer.from(row.password_hash):Buffer.alloc(KDF.keyLength));
    if(!row||!user||!matches)throw denied();
    return this.transaction(()=>{
      const current=this.access.activeUser(userId,this.now()),latest=this.row(userId);
      if(!current||!same(current.tokenHash,user.tokenHash)||latest?.revision!==row.revision)throw denied();
      return this.issue(current,row.revision);
    });
  }
  async setPassword(token:string,adminToken:string,input:unknown):Promise<HumanLogin> {
    this.ready();inputValid(object(input)&&Object.keys(input).every(key=>['password','currentPassword'].includes(key))&&passwordShape(input.password,true)&&(input.currentPassword===undefined||passwordShape(input.currentPassword)));
    const {password,currentPassword}=input as {password:string;currentPassword?:string};
    const auth=this.authenticate(token,adminToken),id=auth.principal.id;this.budget.attempt(id);
    const before=this.row(id),configured=before&&same(before.binding,auth.binding);
    if(configured){
      this.validRecord(before);const actual=await this.queue.derive(currentPassword??'',before.salt);this.ready();
      if(!currentPassword||!timingSafeEqual(actual,Buffer.from(before.password_hash)))throw denied();
    }else if(auth.authentication!=='personal-token')throw denied();
    const salt=randomBytes(16),hash=await this.queue.derive(password,salt);this.ready();
    return this.transaction(()=>{
      // Revalidate the caller and compare-and-swap after async KDF work.
      const current=this.authenticate(token,adminToken),latest=this.row(id);
      if(current.principal.id!==id||!same(current.binding,auth.binding))throw denied();
      check(latest?.revision===before?.revision,'Password changed concurrently; sign in again.','AUTH_CONFLICT');
      const revision=randomUUID();
      this.db.prepare(`INSERT INTO passwords(user_id,binding,salt,password_hash,kdf_version,kdf_n,kdf_r,kdf_p,revision,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET binding=excluded.binding,salt=excluded.salt,password_hash=excluded.password_hash,kdf_version=excluded.kdf_version,kdf_n=excluded.kdf_n,kdf_r=excluded.kdf_r,kdf_p=excluded.kdf_p,revision=excluded.revision,updated_at=excluded.updated_at`).run(id,auth.binding,salt,hash,KDF.version,KDF.N,KDF.r,KDF.p,revision,this.now());
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      const user=this.access.activeUser(id,this.now());if(!user||!same(user.tokenHash,auth.binding))throw denied();
      return this.issue(user,revision);
    });
  }
  logout(token:string,adminToken:string):{loggedOut:true} {
    const auth=this.authenticate(token,adminToken);
    if(auth.authentication==='password-session')this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
    return {loggedOut:true};
  }
  close():Promise<void> {
    return this.closing??=(async()=>{this.closed=true;await this.queue.close();this.db.close();})();
  }
}
