import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, readFileSync, existsSync, lstatSync, rmdirSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('CLI starts through a release-directory symlink without logging its credential',async()=>{
  const temp=mkdtempSync(join(tmpdir(),'coop-cli-symlink-')),link=join(temp,'current');
  symlinkSync(fileURLToPath(new URL('../src',import.meta.url)),link,process.platform==='win32'?'junction':'dir');
  const token='cli-base64-token-never-log-this-value';
  const env={...process.env,COOP_DATA_DIR:join(temp,'data'),PORT:'0',COOP_ADMIN_TOKEN:token};
  for(const key of ['COOP_DB','COOP_USERS_FILE','COOP_TRUSTED_PROXY_ORIGIN'])delete env[key];
  const child=spawn(process.execPath,[join(link,'server.ts')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const ended=new Promise<void>(r=>child.once('exit',()=>r()));
  try{
    const discovery=join(temp,'data','connection.json');
    for(let i=0;i<100&&!existsSync(discovery)&&child.exitCode===null;i++)await new Promise(r=>setTimeout(r,30));
    assert.ok(existsSync(discovery),'CLI should stay running and publish local connection metadata');
    const connection=JSON.parse(readFileSync(discovery,'utf8'));
    assert.equal((await fetch(connection.baseUrl+'/health')).status,200);
    const identity=await fetch(connection.apiUrl+'/identity',{headers:{Authorization:`Bearer ${token}`}});
    assert.equal(identity.status,200);assert.ok(!output.includes(token));
  }finally{
    child.kill('SIGTERM');await ended;
    // Remove only the junction itself, never recursively traverse its target.
    if(lstatSync(link).isSymbolicLink()){if(process.platform==='win32')rmdirSync(link);else unlinkSync(link);}
  }
});
