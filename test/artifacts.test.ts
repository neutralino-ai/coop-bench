import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Authority } from '../src/authority.ts';
import { ARTIFACT_CHUNK_SIZE } from '../src/artifact-store.ts';
import { takeTime } from '../src/games/take-time.ts';
import type { GameAdapter } from '../src/types.ts';

const fixture:GameAdapter={metadata:{...takeTime.metadata,id:'artifact-fixture'},setup:()=>({ended:false}),observe:(s,p)=>({ended:s.ended,playerId:p}),activePlayers:()=>['p1'],legalActions:()=>[],step:()=>({ended:true}),outcome:s=>s.ended?{success:true,score:1,reason:'fixture completed'}:null};
const setup={playerCount:3,scenarioId:'official-clock-1-1',seed:'artifact-fixture'};
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const manifest=(bytes:Buffer,extra={})=>({name:'完整轨迹.jsonl',mediaType:'application/jsonl',kind:'agent-trace',byteLength:bytes.length,sha256:digest(bytes),reasoningAvailability:'provided',provider:'client-fixture',model:'test',tokenCounts:{input:3,output:5,reasoning:2},...extra});
const rejects=(fn:()=>unknown,code:string)=>assert.throws(fn,(error:any)=>error.code===code);
const ended=(a:Authority)=>{const c=a.create(fixture.metadata.id,setup);a.truncate(c.episodeId,'artifact fixture');return c;};
const put=(a:Authority,c:ReturnType<Authority['create']>,id:string,bytes:Buffer)=>{
  for(let offset=0;offset<bytes.length;offset+=ARTIFACT_CHUNK_SIZE)a.putArtifactChunk(c.episodeId,c.seats[0].token,id,{index:offset/ARTIFACT_CHUNK_SIZE,dataBase64:bytes.subarray(offset,offset+ARTIFACT_CHUNK_SIZE).toString('base64')});
};
const contents=(a:Authority,c:ReturnType<Authority['create']>,id:string)=>Buffer.concat([...a.seatArtifactContent(c.episodeId,c.seats[0].token,id).chunks]);

test('only an ended episode seat may upload; role impersonation, another seat and other episodes are isolated',()=>{
  const a=new Authority(':memory:',[fixture],'build-a');try{
    const c=a.create(fixture.metadata.id,setup),bytes=Buffer.from('client-provided reasoning tokens [9,10]');
    rejects(()=>a.createArtifact(c.episodeId,c.seats[0].token,'upload',manifest(bytes)),'EPISODE_ACTIVE');
    a.truncate(c.episodeId,'ended');
    rejects(()=>a.createArtifact(c.episodeId,'operator-token','upload',manifest(bytes)),'UNAUTHORIZED');
    const item=a.createArtifact(c.episodeId,c.seats[0].token,'upload',manifest(bytes));
    assert.equal(item.playerId,'p1');assert.equal(item.provenance,'client-supplied-unverified');
    rejects(()=>a.putArtifactChunk(c.episodeId,c.seats[1].token,item.id,{index:0,dataBase64:bytes.toString('base64')}),'NOT_FOUND');
    rejects(()=>a.completeArtifact(c.episodeId,c.seats[1].token,item.id),'NOT_FOUND');
    assert.deepEqual(a.listSeatArtifacts(c.episodeId,c.seats[1].token).artifacts,[]);
    assert.equal('artifactCount' in a.listSeatArtifacts(c.episodeId,c.seats[1].token).retention,false);
    const other=ended(a);rejects(()=>a.completeArtifact(other.episodeId,other.seats[0].token,item.id),'NOT_FOUND');
    put(a,c,item.id,bytes);a.completeArtifact(c.episodeId,c.seats[0].token,item.id);
    rejects(()=>a.seatArtifactContent(c.episodeId,c.seats[1].token,item.id),'NOT_FOUND');
    assert.deepEqual(contents(a,c,item.id),bytes);assert.equal(a.listRolloutArtifacts(c.episodeId).artifacts.length,1);
  }finally{a.close();}
});

test('chunk retries are byte-identical, out-of-order resumable; incomplete and digest-mismatched evidence cannot download',()=>{
  const a=new Authority(':memory:',[fixture],'build-a');try{
    const c=ended(a),token=c.seats[0].token,bytes=Buffer.alloc(ARTIFACT_CHUNK_SIZE+4,75),input=manifest(bytes);
    const item=a.createArtifact(c.episodeId,token,'stable',input);
    assert.equal(a.createArtifact(c.episodeId,token,'stable',{...input,tokenCounts:{reasoning:2,output:5,input:3}}).id,item.id);
    rejects(()=>a.createArtifact(c.episodeId,token,'stable',{...input,name:'changed.json'}),'IDEMPOTENCY_CONFLICT');
    const tail={index:1,dataBase64:bytes.subarray(ARTIFACT_CHUNK_SIZE).toString('base64')};
    a.putArtifactChunk(c.episodeId,token,item.id,tail);a.putArtifactChunk(c.episodeId,token,item.id,tail);
    assert.deepEqual(a.listSeatArtifacts(c.episodeId,token).artifacts[0].missingChunks,[0]);
    rejects(()=>a.completeArtifact(c.episodeId,token,item.id),'ARTIFACT_INCOMPLETE');
    rejects(()=>a.seatArtifactContent(c.episodeId,token,item.id),'ARTIFACT_INCOMPLETE');
    rejects(()=>a.putArtifactChunk(c.episodeId,token,item.id,{index:1,dataBase64:Buffer.alloc(4,76).toString('base64')}),'IDEMPOTENCY_CONFLICT');
    put(a,c,item.id,bytes);const complete=a.completeArtifact(c.episodeId,token,item.id);
    assert.deepEqual(a.completeArtifact(c.episodeId,token,item.id),complete);
    assert.deepEqual(a.putArtifactChunk(c.episodeId,token,item.id,tail),complete);
    const bad=a.createArtifact(c.episodeId,token,'wrong-sha',manifest(bytes,{sha256:'0'.repeat(64)}));put(a,c,bad.id,bytes);
    rejects(()=>a.completeArtifact(c.episodeId,token,bad.id),'ARTIFACT_DIGEST_MISMATCH');
    assert.equal(a.listSeatArtifacts(c.episodeId,token).artifacts.find(x=>x.id===bad.id)?.status,'uploading');
    rejects(()=>a.seatArtifactContent(c.episodeId,token,bad.id),'ARTIFACT_INCOMPLETE');
    assert.deepEqual(contents(a,c,item.id),bytes);
  }finally{a.close();}
});

test('strict manifests and base64 prevent chunk-size, header and prototype abuse',()=>{
  const a=new Authority(':memory:',[fixture],'build-a');try{
    const c=ended(a),bytes=Buffer.from('a'),token=c.seats[0].token;
    for(const extra of [{name:'../../secret'},{name:'evil\r\nheader'},{name:'a\\b'},{byteLength:-1},{byteLength:1.5},{sha256:'A'.repeat(64)},{mediaType:'text/html\r\nX-Test: yes'},{provider:'x\u0000'},{reasoningAvailability:'verified'},{tokenCounts:{reasoning:-1}},{tokenCounts:{reasoning:1.2}},{tokenCounts:JSON.parse('{"__proto__":4}')},{playerId:'p2'}])rejects(()=>a.createArtifact(c.episodeId,token,'invalid',manifest(bytes,extra)),'INVALID_REQUEST');
    rejects(()=>a.createArtifact(c.episodeId,token,'too-large',manifest(bytes,{byteLength:64*1024*1024+1})),'RESOURCE_LIMIT');
    const item=a.createArtifact(c.episodeId,token,'valid',manifest(bytes));
    for(const input of [{index:-1,dataBase64:'YQ=='},{index:1,dataBase64:'YQ=='},{index:0,dataBase64:'YQ'},{index:0,dataBase64:'YR=='},{index:0,dataBase64:'YQ==\n'},{index:0,dataBase64:'YWI='},{index:0,dataBase64:'YQ==',playerId:'p2'}])rejects(()=>a.putArtifactChunk(c.episodeId,token,item.id,input),'INVALID_REQUEST');
    assert.deepEqual(a.listSeatArtifacts(c.episodeId,token).artifacts[0].receivedChunks,[]);
  }finally{a.close();}
});

test('empty client files verify normally and a completed game can upload without truncation',()=>{
  const a=new Authority(':memory:',[fixture],'build-a');try{
    const c=a.create(fixture.metadata.id,setup),token=c.seats[0].token,o=a.observe(c.episodeId,token);
    assert.equal(a.submit(c.episodeId,token,'finish',{observationId:o.observationId,decisionToken:o.decisionToken,action:{type:'finish'}}).status,200);
    const item=a.createArtifact(c.episodeId,token,'empty',manifest(Buffer.alloc(0),{reasoningAvailability:'not-provided'}));
    assert.equal(item.chunkCount,0);assert.equal(a.completeArtifact(c.episodeId,token,item.id).status,'complete');
    assert.equal(contents(a,c,item.id).length,0);
  }finally{a.close();}
});

test('reservations prevent oversubscription and quota rejection never deletes historical or unfinished evidence',()=>{
  const a=new Authority(':memory:',[fixture],'build-a',Date.now,{maxArtifactStoredBytesTotal:1000,maxArtifactsPerSeat:1});try{
    const c=ended(a),token=c.seats[0].token,bytes=Buffer.alloc(400,1),item=a.createArtifact(c.episodeId,token,'reserve',manifest(bytes));
    const reserved=a.artifacts.retention().reservedBytes!;assert.ok(reserved>400);
    rejects(()=>a.createArtifact(c.episodeId,c.seats[1].token,'overflow',manifest(bytes)),'RESOURCE_LIMIT');
    rejects(()=>a.createArtifact(c.episodeId,token,'count-overflow',manifest(Buffer.alloc(0))),'RESOURCE_LIMIT');
    assert.equal(a.createArtifact(c.episodeId,token,'reserve',manifest(bytes)).id,item.id);
    put(a,c,item.id,bytes);a.completeArtifact(c.episodeId,token,item.id);
    assert.equal(a.artifacts.retention().reservedBytes,reserved);assert.deepEqual(contents(a,c,item.id),bytes);
    assert.equal(a.retention().automaticDeletion,false);assert.equal(a.retention().onCapacity,'reject-new-writes');
  }finally{a.close();}
});

test('incomplete and complete uploads persist across builds, credentials remain seat-bound, shared SQLite enforces reservation',()=>{
  const dir=mkdtempSync(join(tmpdir(),'coop-artifacts-')),file=join(dir,'episodes.sqlite');
  let a=new Authority(file,[fixture],'build-a',Date.now,{maxArtifactStoredBytesTotal:1100});let b:Authority|undefined;
  try{
    const c=ended(a),token=c.seats[0].token,bytes=Buffer.alloc(500,2),item=a.createArtifact(c.episodeId,token,'persist',manifest(bytes));
    const eventCount=a.db.prepare('SELECT COUNT(*) AS n FROM events').get()!.n;
    b=new Authority(file,[fixture],'build-a',Date.now,{maxArtifactStoredBytesTotal:1100});
    rejects(()=>b!.createArtifact(c.episodeId,c.seats[1].token,'other-process',manifest(bytes)),'RESOURCE_LIMIT');b.close();b=undefined;
    a.close();a=new Authority(file,[fixture],'build-b',Date.now,{maxArtifactStoredBytesTotal:1});
    assert.equal(a.listSeatArtifacts(c.episodeId,token).artifacts[0].status,'uploading');
    put(a,c,item.id,bytes);a.completeArtifact(c.episodeId,token,item.id);
    assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM events').get()!.n,eventCount);
    assert.deepEqual(contents(a,c,item.id),bytes);
    a.close();a=new Authority(file,[],'build-c');
    assert.deepEqual(contents(a,c,item.id),bytes);assert.equal(a.getRollout(c.episodeId).summary.status,'truncated');
    rejects(()=>a.observe(c.episodeId,token),'BUILD_MISMATCH');
  }finally{b?.close();a.close();for(const name of readdirSync(dir))unlinkSync(join(dir,name));rmdirSync(dir);}
});
