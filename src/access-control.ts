import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { check, RuleError } from './common.ts';

export type AccessRole = 'auditor' | 'operator';
export type AccessPermission = 'rollout:read' | 'rollout:annotate' | 'episode:create' | 'episode:truncate' | 'episode:export' | 'episode:replay';
export interface AccessUser { id:string; role:AccessRole; tokenHash:string; disabled:boolean; expiresAt?:string }
export interface AccessUsers { version:1; users:AccessUser[] }
export interface AccessPrincipal { id:string; role:AccessRole|'coordinator'; source:string }
export interface AccessOptions { usersFile?:string; optionalMissingUsersFile?:boolean; trustedProxyOrigin?:string }

const idPattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const allowed:Record<AccessRole,readonly AccessPermission[]>={
  auditor:['rollout:read','rollout:annotate'],
  operator:['rollout:read','rollout:annotate','episode:create','episode:truncate','episode:export','episode:replay']
};
function valid(condition:unknown):asserts condition { check(condition,'Invalid access-user configuration.','INVALID_CONFIG'); }
function plain(value:unknown):value is Record<string,unknown> {
  return !!value && typeof value==='object' && !Array.isArray(value) && Object.getPrototypeOf(value)===Object.prototype;
}
function same(a:string,b:string):boolean { const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y); }
export function tokenHash(token:string):string { return createHash('sha256').update(token).digest('hex'); }
export function newAccessToken():string { return randomBytes(32).toString('base64url'); }

/** The on-disk list contains digests only. Each request reloads it so revocation is immediate. */
export function validateAccessUsers(input:unknown):AccessUsers {
  valid(plain(input)&&Object.keys(input).every(k=>['version','users'].includes(k))&&input.version===1);
  valid(Array.isArray(input.users)&&input.users.length<=64);
  const ids=new Set<string>(),hashes=new Set<string>();
  for(const user of input.users){
    valid(plain(user)&&Object.keys(user).every(k=>['id','role','tokenHash','disabled','expiresAt'].includes(k)));
    valid(typeof user.id==='string'&&idPattern.test(user.id)&&user.id!=='coordinator'&&!ids.has(user.id));
    valid(user.role==='auditor'||user.role==='operator');
    valid(typeof user.tokenHash==='string'&&/^[a-f0-9]{64}$/.test(user.tokenHash)&&!hashes.has(user.tokenHash));
    valid(typeof user.disabled==='boolean');
    if(user.expiresAt!==undefined)valid(typeof user.expiresAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(user.expiresAt)&&Number.isFinite(Date.parse(user.expiresAt))&&new Date(user.expiresAt).toISOString()===user.expiresAt);
    ids.add(user.id);hashes.add(user.tokenHash);
  }
  return input as unknown as AccessUsers;
}

export function readAccessUsers(path:string,optionalMissing=false):AccessUsers {
  try {
    const stat=statSync(path);valid(stat.isFile()&&stat.size<=65536);
    const text=readFileSync(path,'utf8');valid(Buffer.byteLength(text)<=65536);
    return validateAccessUsers(JSON.parse(text));
  }catch(error){
    if(optionalMissing&&(error as NodeJS.ErrnoException).code==='ENOENT')return {version:1,users:[]};
    // Never expose file contents, raw JSON parser excerpts, paths, or credential digests.
    throw new RuleError('INVALID_CONFIG','Access-user configuration unavailable or invalid.');
  }
}

export class AccessControl {
  private readonly options:AccessOptions;
  private readonly proxyOrigin?:string;
  private readonly proxyHost?:string;
  get sharingEnabled():boolean { return this.proxyOrigin!==undefined; }
  get humanPasswordEnabled():boolean { return this.sharingEnabled && !!this.options.usersFile && existsSync(this.options.usersFile); }
  constructor(options:AccessOptions={}) {
    this.options={...options};
    if(options.trustedProxyOrigin!==undefined){
      let url:URL;try{url=new URL(options.trustedProxyOrigin);}catch{throw new RuleError('INVALID_CONFIG','Invalid trusted proxy origin.');}
      // A single exact HTTPS origin, never a wildcard or user-controlled forwarded header.
      // Both a private Serve endpoint and a cloud HTTPS proxy use this boundary.
      // Canonical spelling prevents URL normalization from accepting aliases.
      const labels=url.hostname.split('.');
      check(url.protocol==='https:'&&url.origin===options.trustedProxyOrigin&&!url.username&&!url.password&&!url.port&&
        !isIP(url.hostname)&&url.hostname.length<=253&&labels.length>=2&&
        labels.every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))&&
        /[a-z]/.test(labels[labels.length-1]),
      'Trusted proxy origin must be an exact canonical HTTPS DNS origin without a port or path.','INVALID_CONFIG');
      this.proxyOrigin=url.origin;this.proxyHost=url.host;
    }
    if(options.usersFile)readAccessUsers(options.usersFile,options.optionalMissingUsersFile);
  }

  assertRequest(request:Pick<IncomingMessage,'headers'|'socket'>,port:number):'local'|'proxy' {
    check(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress??''),'Loopback peer required.','FORBIDDEN');
    const host=request.headers.host,origin=request.headers.origin;
    const localHosts=[`127.0.0.1:${port}`,`localhost:${port}`];
    const isLocal=typeof host==='string'&&localHosts.includes(host);
    const isProxy=typeof host==='string'&&!!this.proxyHost&&host===this.proxyHost;
    check(isLocal||isProxy,'Host is not allowed.','FORBIDDEN');
    if(origin!==undefined){
      check(typeof origin==='string'&&(isProxy?origin===this.proxyOrigin:localHosts.some(h=>origin===`http://${h}`)),
        'Cross-origin request rejected.','FORBIDDEN');
    }
    // X-Forwarded-For, Forwarded, X-Forwarded-Host and Tailscale identity headers
    // do not prove authorization. Bearer credentials are checked separately.
    return isProxy?'proxy':'local';
  }

  authorize(token:string,adminToken:string,permission:AccessPermission):AccessPrincipal {
    check(typeof token==='string'&&token.length>=24&&token.length<=256,'Credential required.','UNAUTHORIZED');
    if(same(token,adminToken)){
      // A proxy preserves client Host; a caller can request a local-looking Host.
      // Disable the master credential for the whole HTTP app while sharing.
      check(!this.sharingEnabled,'Coordinator credential is disabled while sharing; use an individual operator credential.','FORBIDDEN');
      return {id:'coordinator',role:'coordinator',source:'coordinator'};
    }
    const users=this.options.usersFile?readAccessUsers(this.options.usersFile,this.options.optionalMissingUsersFile).users:[];
    const hash=tokenHash(token),user=users.find(u=>same(u.tokenHash,hash));
    check(user&&!user.disabled&&(!user.expiresAt||Date.parse(user.expiresAt)>Date.now()),'Credential required.','UNAUTHORIZED');
    check(allowed[user.role].includes(permission),'Credential does not allow this operation.','FORBIDDEN');
    return {id:user.id,role:user.role,source:user.id};
  }

  /** Password sessions retain the current access-user policy, never a role snapshot. */
  activeUser(id:string,at=Date.now()):AccessUser|undefined {
    const users=this.options.usersFile?readAccessUsers(this.options.usersFile,this.options.optionalMissingUsersFile).users:[];
    const user=users.find(entry=>entry.id===id);
    return user&&!user.disabled&&(!user.expiresAt||Date.parse(user.expiresAt)>at)?user:undefined;
  }
  authorizeUser(id:string,permission:AccessPermission,binding:string,at=Date.now()):AccessPrincipal {
    const user=this.activeUser(id,at);
    check(user&&same(user.tokenHash,binding),'Credential required.','UNAUTHORIZED');
    check(allowed[user.role].includes(permission),'Credential does not allow this operation.','FORBIDDEN');
    return {id:user.id,role:user.role,source:user.id};
  }
}
