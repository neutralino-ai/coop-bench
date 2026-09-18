import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Authority } from '../src/authority.ts';
import { createApi } from '../src/server.ts';
import { takeTime } from '../src/games/take-time.ts';
import { AccessControl, tokenHash } from '../src/access-control.ts';

const admin='test-coordinator-artifact-long-token',operator='test-operator-artifact-long-token',auditor='test-auditor-artifact-long-token';
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'coop-artifact-http-')),usersFile=join(dir,'users.json');
  writeFileSync(usersFile,JSON.stringify({version:1,users:[{id:'operator',role:'operator',tokenHash:tokenHash(operator),disabled:false},{id:'auditor',role:'auditor',tokenHash:tokenHash(auditor),disabled:false}]}));
  const a=new Authority(':memory:',[takeTime],'artifact-http');
  const app=createApi(a,admin,{access:new AccessControl({usersFile}),ratePolicy:{globalBurst:1000,credentialBurst:1000,heavyBurst:1000}});
  await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(app.address() as any).port}`;
  const call=(path:string,token='',body?:unknown,headers:Record<string,string>={})=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const close=async()=>{app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));a.close();unlinkSync(usersFile);rmdirSync(dir);};
  return {a,call,close};
}
test('HTTP artifact routes keep seat and human roles separate, preserve request cap and force inert downloads',async()=>{
  const f=await fixture();try{
    const c=f.a.create('take-time',{playerCount:3,scenarioId:'official-clock-1-1',seed:'artifact-http'}),id=c.episodeId,seat=c.seats[0].token,other=c.seats[1].token;
    const bytes=Buffer.from('<script>THIS IS UNTRUSTED CLIENT CONTENT</script>\u0000\u00ff');
    const manifest={name:'完整轨迹 " sample.html',mediaType:'text/html',kind:'agent-trace',byteLength:bytes.length,sha256:digest(bytes),reasoningAvailability:'provided',tokenCounts:{reasoning:11}};
    const path=`/api/v1/episodes/${id}/artifacts`,list=`/api/v1/rollouts/${id}/artifacts`;
    assert.equal((await f.call(list)).status,401);
    assert.equal((await f.call(list,auditor)).status,403);
    assert.equal((await f.call(path,seat,manifest,{'Idempotency-Key':'upload'})).status,409);
    f.a.truncate(id,'HTTP fixture');
    for(const token of ['',operator,auditor,admin])assert.equal((await f.call(path,token,manifest,{'Idempotency-Key':'upload'})).status,401);
    assert.equal((await f.call(path,seat,manifest)).status,400);
    const creation=await f.call(path,seat,manifest,{'Idempotency-Key':'upload'});assert.equal(creation.status,201);const item=await creation.json() as any;
    assert.equal(item.playerId,'p1');assert.equal(item.status,'uploading');
    assert.equal((await f.call(list,seat)).status,401);
    assert.equal((await f.call(`${list}/${item.id}/content`,auditor)).status,409);
    assert.equal((await f.call(`${path}/${item.id}/chunks`,other,{index:0,dataBase64:bytes.toString('base64')})).status,404);
    const oversized=await f.call(`${path}/${item.id}/chunks`,seat,{index:0,dataBase64:'A'.repeat(66000)});assert.equal(oversized.status,413);
    assert.equal((await f.call(`${path}/${item.id}/chunks`,seat,{index:0,dataBase64:bytes.toString('base64')})).status,200);
    assert.equal((await f.call(`${path}/${item.id}/complete`,seat,{})).status,200);
    for(const token of [auditor,operator,admin]){
      const response=await f.call(`${list}/${item.id}/content`,token);assert.equal(response.status,200);
      assert.equal(response.headers.get('content-type'),'application/octet-stream');
      assert.ok(response.headers.get('content-disposition')?.startsWith('attachment; '));
      assert.match(response.headers.get('content-security-policy')!,/sandbox/);
      assert.equal(response.headers.get('x-content-type-options'),'nosniff');
      assert.equal(response.headers.get('x-artifact-sha256'),digest(bytes));
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
    }
    assert.equal((await f.call(`${path}/${item.id}/content`,other)).status,404);
    const ownDownload=await f.call(`${path}/${item.id}/content`,seat);assert.deepEqual(Buffer.from(await ownDownload.arrayBuffer()),bytes);
    const humanList=await (await f.call(list,auditor)).json() as any;assert.equal(humanList.artifacts.length,1);assert.equal(humanList.artifacts[0].provenance,'client-supplied-unverified');
    const identity=await (await f.call('/api/identity',operator)).json() as any;
    assert.equal(identity.retention.policy,'indefinite');assert.equal(identity.retention.artifacts.completeCount,1);
    assert.equal((await f.call(`/episodes/${id}/artifacts`,other)).status,200);
    assert.deepEqual((await (await f.call(path,other)).json() as any).artifacts,[]);
  }finally{await f.close();}
});

test('HTTP download streams multiple BLOB chunks and missing completion cannot expose partially uploaded files',async()=>{
  const f=await fixture();try{
    const c=f.a.create('take-time',{playerCount:3,scenarioId:'official-clock-1-1',seed:'artifact-stream'});f.a.truncate(c.episodeId,'stream fixture');
    const bytes=Buffer.alloc(100*32768+17);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
    const token=c.seats[0].token,item=f.a.createArtifact(c.episodeId,token,'large',{name:'original.bin',mediaType:'application/octet-stream',kind:'attachment',byteLength:bytes.length,sha256:digest(bytes)});
    for(let offset=0;offset<bytes.length;offset+=32768)f.a.putArtifactChunk(c.episodeId,token,item.id,{index:offset/32768,dataBase64:bytes.subarray(offset,offset+32768).toString('base64')});
    const path=`/rollouts/${c.episodeId}/artifacts/${item.id}/content`;
    assert.equal((await f.call(path,auditor)).status,409);f.a.completeArtifact(c.episodeId,token,item.id);
    const response=await f.call(path,auditor),hash=createHash('sha256');let size=0;
    for await(const chunk of response.body!){size+=chunk.length;hash.update(chunk);}
    assert.equal(response.status,200);assert.equal(size,bytes.length);assert.equal(hash.digest('hex'),digest(bytes));
  }finally{await f.close();}
});
