import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, renameSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export function defaultDataDir(platform=process.platform, env=process.env, home=homedir()):string {
  if(env.COOP_DATA_DIR) return resolve(env.COOP_DATA_DIR);
  if(platform==='win32') return join(env.APPDATA ?? join(home,'AppData','Roaming'),'Coop Bench');
  if(platform==='darwin') return join(home,'Library','Application Support','Coop Bench');
  return join(env.XDG_DATA_HOME ?? join(home,'.local','share'),'coop-bench');
}
export function writePrivateJson(path:string,value:unknown):void {
  const temp=`${path}.${randomUUID()}.tmp`;
  try {writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});renameSync(temp,path);}
  finally {if(existsSync(temp))unlinkSync(temp);}
}
export function coordinatorToken(dataDir:string, supplied?:string):string {
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  if(supplied!==undefined){if(supplied.length<24)throw new Error('Coordinator token must be at least 24 characters.');return supplied;}
  const path=join(dataDir,'coordinator-token');
  let token:string;
  if(existsSync(path))token=readFileSync(path,'utf8').trim();
  else {token=randomBytes(32).toString('base64url');writeFileSync(path,token+'\n',{flag:'wx',mode:0o600});}
  if(token.length<24)throw new Error('Stored coordinator token is invalid; check the application data directory.');
  if(process.platform!=='win32')chmodSync(path,0o600);
  return token;
}
/** Separate tiny SQLite file holds an OS-backed lock for the process lifetime.
 * Crash releases the lock automatically; no stale PID files or unlink races.
 */
export function acquireInstance(dataDir:string):()=>void {
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  const db=new DatabaseSync(join(dataDir,'instance-lock.sqlite'));
  try {
    db.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS instance_guard(id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE;');
  }catch(error){
    db.close();
    if((error as Error).message.includes('locked'))throw new Error('Coop Bench is already using this data directory.');
    throw error;
  }
  let released=false;
  return ()=>{if(!released){released=true;db.exec('ROLLBACK');db.close();}};
}
