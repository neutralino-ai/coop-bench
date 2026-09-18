import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { request } from 'node:http';
import { startLocalApp } from '../src/server.ts';
import { defaultDataDir } from '../src/local-settings.ts';

type LocalApp = Awaited<ReturnType<typeof startLocalApp>>;

function tempDirectory():{path:string;remove:()=>void} {
  const root=realpathSync(tmpdir());
  const path=mkdtempSync(join(root,'coop-bench-local-app-test-'));
  return {path,remove:()=>{
    if(!existsSync(path))return;
    const actual=realpathSync(path),child=relative(root,actual);
    // Verify the actual absolute path immediately before recursive cleanup.
    assert.equal(actual,realpathSync(path));
    assert.ok(child && !isAbsolute(child) && child!=='..' && !child.startsWith(`..${process.platform==='win32'?'\\':'/'}`));
    assert.ok(basename(actual).startsWith('coop-bench-local-app-test-'));
    assert.equal(actual,resolve(path));
    rmSync(actual,{recursive:true,force:true});
  }};
}

async function json(url:string,init?:RequestInit):Promise<{status:number;body:any}> {
  const response=await fetch(url,init);
  return {status:response.status,body:await response.json()};
}
function authenticated(token:string,body?:unknown,requestId?:string):RequestInit {
  return {method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,
    ...(body===undefined?{}:{'Content-Type':'application/json'}),...(requestId?{'Idempotency-Key':requestId}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})};
}

test('local data directory follows Windows/macOS user data conventions and explicit override',()=>{
  assert.equal(defaultDataDir('win32',{APPDATA:join(tmpdir(),'roaming')},'unused'),join(tmpdir(),'roaming','Coop Bench'));
  assert.equal(defaultDataDir('win32',{},join(tmpdir(),'person')),join(tmpdir(),'person','AppData','Roaming','Coop Bench'));
  assert.equal(defaultDataDir('darwin',{},join(tmpdir(),'person')),join(tmpdir(),'person','Library','Application Support','Coop Bench'));
  assert.equal(defaultDataDir('darwin',{COOP_DATA_DIR:'custom-local-data'},'unused'),resolve('custom-local-data'));
});

test('embedded API has three route aliases, rejects hostile origins/hosts, and keeps coordinator credentials out of HTTP assets/discovery',async()=>{
  const temp=tempDirectory();let local:LocalApp|undefined;
  try{
    local=await startLocalApp({dataDir:temp.path,port:0});
    for(const prefix of ['/api/v1','/api','']){
      const result=await json(`${local.baseUrl}${prefix}/games`);
      assert.equal(result.status,200);assert.equal(result.body.games.length,10);
    }
    const health=await json(`${local.apiUrl}/health`);assert.equal(health.status,200);assert.equal(health.body.apiVersion,'v1');
    const hostile=await json(`${local.apiUrl}/games`,{headers:{Origin:'https://evil.example'}});
    assert.equal(hostile.status,403);assert.equal(hostile.body.error.code,'FORBIDDEN');
    const spoofed=await new Promise<number>((resolve,reject)=>{
      const url=new URL(local!.baseUrl);
      const req=request({hostname:'127.0.0.1',port:Number(url.port),path:'/api/v1/games',headers:{Host:`evil.example:${url.port}`}},res=>{
        res.resume();res.once('end',()=>resolve(res.statusCode!));
      });req.once('error',reject);req.end();
    });assert.equal(spoofed,403);
    const noCredential=await json(`${local.apiUrl}/episodes`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({gameId:'take-time',playerCount:2,scenarioId:'official-clock-1-1'})});
    assert.equal(noCredential.status,401);
    for(const asset of ['/','/app.js','/style.css']){
      const response=await fetch(local.baseUrl+asset);assert.equal(response.status,200);
      assert.ok(!(await response.text()).includes(local.adminToken));
    }
    const serialized=readFileSync(local.discoveryPath,'utf8'),connection=JSON.parse(serialized);
    assert.ok(!serialized.includes(local.adminToken));assert.ok(!('adminToken' in connection));
    assert.equal(connection.apiUrl,local.apiUrl);assert.equal(connection.baseUrl,local.baseUrl);
    assert.equal(connection.pid,process.pid);assert.equal(connection.dbPath,local.dbPath);
    const noPrivateFile=await json(`${local.baseUrl}/connection.json`);assert.equal(noPrivateFile.status,404);
  }finally{await local?.close();temp.remove();}
});

test('one local data directory has one owner; restart preserves coordinator credential, SQLite game and each seat view',async()=>{
  const temp=tempDirectory();let local:LocalApp|undefined;
  try{
    local=await startLocalApp({dataDir:temp.path,port:0});
    const initialToken=local.adminToken;
    await assert.rejects(startLocalApp({dataDir:temp.path,port:0}),/already|locked|busy|using/i);
    const creation=await json(`${local.apiUrl}/episodes`,authenticated(initialToken,{gameId:'take-time',playerCount:2,scenarioId:'official-clock-1-1'}));
    assert.equal(creation.status,201);
    const {episodeId,seats}=creation.body;
    assert.equal(seats.length,2);
    const observationPath=`/episodes/${episodeId}/observation`;
    const before=await json(local.apiUrl+observationPath,authenticated(seats[0].token));
    assert.equal(before.status,200);assert.equal(before.body.view.hand,null);
    const prepared={observationId:before.body.observationId,decisionToken:before.body.decisionToken,action:{type:'look_hand'}};
    const receipt=await json(`${local.apiUrl}/episodes/${episodeId}/actions`,authenticated(seats[0].token,prepared,'look-before-restart'));
    assert.equal(receipt.status,200);assert.equal(receipt.body.observation.view.hand.length,4);
    const other=await json(local.apiUrl+observationPath,authenticated(seats[1].token));
    assert.equal(other.status,200);assert.equal(other.body.view.hand,null);
    const discoveryPath=local.discoveryPath;
    await local.close();await local.close();local=undefined;
    assert.equal(existsSync(discoveryPath),false);
    local=await startLocalApp({dataDir:temp.path,port:0});
    assert.equal(local.adminToken,initialToken);
    const resumed=await json(local.apiUrl+observationPath,authenticated(seats[0].token));
    assert.equal(resumed.status,200);assert.deepEqual(resumed.body.view,receipt.body.observation.view);
    const stillPrivate=await json(local.apiUrl+observationPath,authenticated(seats[1].token));
    assert.equal(stillPrivate.status,200);assert.equal(stillPrivate.body.view.hand,null);
    const retry=await json(`${local.apiUrl}/episodes/${episodeId}/actions`,authenticated(seats[0].token,prepared,'look-before-restart'));
    assert.deepEqual(retry,receipt);
    const cannotCoordinate=await json(`${local.apiUrl}/episodes`,authenticated(seats[0].token,{gameId:'take-time',playerCount:2,scenarioId:'official-clock-1-1'}));
    assert.equal(cannotCoordinate.status,401);
  }finally{await local?.close();temp.remove();}
});

test('an occupied preferred port fails strictly or chooses another port explicitly, releasing failed startup resources',async()=>{
  const first=tempDirectory(),second=tempDirectory();let occupied:LocalApp|undefined,fallback:LocalApp|undefined;
  try{
    occupied=await startLocalApp({dataDir:first.path,port:0});
    const port=Number(new URL(occupied.baseUrl).port);
    await assert.rejects(startLocalApp({dataDir:second.path,port}),{code:'EADDRINUSE'});
    assert.equal(existsSync(join(second.path,'connection.json')),false);
    fallback=await startLocalApp({dataDir:second.path,port,fallbackPort:true});
    assert.notEqual(new URL(fallback.baseUrl).port,String(port));
    assert.equal((await json(`${fallback.apiUrl}/health`)).body.ok,true);
    assert.equal((await json(`${occupied.apiUrl}/health`)).body.ok,true);
  }finally{await fallback?.close();await occupied?.close();second.remove();first.remove();}
});

test('invalid ports are rejected before creating application data files',async()=>{
  const temp=tempDirectory();
  try{
    for(const port of [-1,65536,1.25,Number.NaN]){
      const dataDir=join(temp.path,`invalid-${String(port)}`);
      await assert.rejects(startLocalApp({dataDir,port}),/Port must be/);
      assert.equal(existsSync(dataDir),false);
    }
  }finally{temp.remove();}
});
