import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Authority } from '../src/authority.ts';
import { games } from '../src/registry.ts';
import { createApi, startLocalApp } from '../src/server.ts';

const token='api-only-local-test-coordinator-token';
const staticPaths=['/','/play','/app.js','/style.css','/play.js','/play.css','/transport.js'];

test('API-only disables every web resource and normalized API alias while preserving authenticated APIs',async()=>{
  const authority=new Authority(':memory:',games,'api-only-test');
  const app=createApi(authority,token,{serveWeb:false,ratePolicy:{credentialBurst:120,globalBurst:240}});
  await new Promise<void>(resolve=>app.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(app.address() as any).port}`;
  try {
    for(const prefix of ['', '/api', '/api/v1'])for(const path of staticPaths){
      const response=await fetch(base+prefix+path);
      assert.equal(response.status,404,prefix+path);
      assert.match(response.headers.get('content-type')??'',/application\/json/);
      assert.equal((await response.json() as any).error.code,'NOT_FOUND');
    }
    for(const prefix of ['/api','/api/v1'])assert.equal((await fetch(base+prefix)).status,404);
    assert.equal((await fetch(base+'/health')).status,200);
    assert.equal((await fetch(base+'/api/v1/health')).status,200);
    const catalog=await (await fetch(base+'/api/v1/games')).json() as any;
    assert.equal(catalog.games.length,games.length);
    assert.equal((await fetch(base+'/api/v1/rollouts')).status,401);
    const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
    const response=await fetch(base+'/api/v1/episodes',{method:'POST',headers,
      body:JSON.stringify({gameId:'hanabi',scenarioId:games.find(g=>g.metadata.id==='hanabi')!.metadata.scenarios[0].id,playerCount:3})});
    assert.equal(response.status,201);
    const created=await response.json() as any;
    const observation=await fetch(base+`/api/v1/episodes/${created.episodeId}/observation`,{
      headers:{Authorization:`Bearer ${created.seats[0].token}`}});
    assert.equal(observation.status,200);
    assert.equal((await observation.json() as any).playerId,'p1');
    const rollout=await fetch(base+`/api/v1/rollouts/${created.episodeId}`,{headers});
    assert.equal(rollout.status,200);
  }finally{app.closeAllConnections();await new Promise<void>(resolve=>app.close(()=>resolve()));authority.close();}
});

test('default server still serves the browser UI and shared transport resource',async()=>{
  const authority=new Authority(':memory:',games,'web-default-test'),app=createApi(authority,token);
  await new Promise<void>(resolve=>app.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(app.address() as any).port}`;
  try {
    for(const path of staticPaths){const response=await fetch(base+path);assert.equal(response.status,200,path);await response.text();}
    assert.equal((await fetch(base+'/api/v1/play')).status,200);
    assert.equal((await fetch(base+'/api/v1/transport.js')).status,200);
  }finally{app.closeAllConnections();await new Promise<void>(resolve=>app.close(()=>resolve()));authority.close();}
});

test('embedded startLocalApp accepts explicit backend-only mode',async()=>{
  const app=await startLocalApp({dataDir:mkdtempSync(join(tmpdir(),'coop-api-only-')),port:0,serveWeb:false});
  try {
    assert.equal((await fetch(app.baseUrl+'/')).status,404);
    assert.equal((await fetch(app.apiUrl+'/games')).status,200);
  }finally{await app.close();}
});

test('COOP_API_ONLY=1 applies to the real CLI without changing API discovery',async()=>{
  const dataDir=mkdtempSync(join(tmpdir(),'coop-api-only-cli-'));
  const env={...process.env,COOP_DATA_DIR:dataDir,COOP_API_ONLY:'1',PORT:'0',COOP_ADMIN_TOKEN:token};
  for(const key of ['COOP_DB','COOP_USERS_FILE','COOP_TRUSTED_PROXY_ORIGIN'])delete env[key];
  const child=spawn(process.execPath,[fileURLToPath(new URL('../src/server.ts',import.meta.url))],{
    env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  try {
    const discovery=join(dataDir,'connection.json');
    for(let i=0;i<150&&!existsSync(discovery)&&child.exitCode===null;i++)await new Promise(resolve=>setTimeout(resolve,30));
    assert.ok(existsSync(discovery),'CLI should publish its API discovery file');
    const info=JSON.parse(readFileSync(discovery,'utf8'));
    assert.equal((await fetch(info.baseUrl+'/')).status,404);
    assert.equal((await fetch(info.apiUrl+'/transport.js')).status,404);
    assert.equal((await fetch(info.apiUrl+'/health')).status,200);
    assert.equal((await fetch(info.apiUrl+'/identity',{headers:{Authorization:`Bearer ${token}`}})).status,200);
    assert.ok(!output.includes(token));
  }finally{child.kill('SIGTERM');await ended;}
});
