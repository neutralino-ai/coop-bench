import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { request as httpRequest } from 'node:http';
import { Authority } from '../src/authority.ts';
import { createApi } from '../src/server.ts';
import { games } from '../src/registry.ts';

// All adversarial requests use an ephemeral loopback port and in-memory database.
// Never point this suite at a running user's service or reuse real credentials.
const admin='security-fixture-coordinator-only-credential';
async function fixture() {
  const authority=new Authority(':memory:',games,'security-http-fixture');
  const server=createApi(authority,admin);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as any).port,base=`http://127.0.0.1:${port}`;
  const create=()=>authority.create('take-time',{playerCount:3,scenarioId:'official-clock-1-1',seed:'security-fixture'});
  return {authority,server,base,port,create,
    async request(path:string,token?:string,payload?:unknown,headers:Record<string,string>={}) {
      // Unlike fetch, node:http preserves deliberately hostile Host values.
      return new Promise<{status:number;headers:Headers;text:string}>((resolve,reject)=>{
        const request=httpRequest(base+path,{method:payload===undefined?'GET':'POST',
          headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(payload===undefined?{}:{'Content-Type':'application/json'}),...headers}},response=>{
          let text='';response.setEncoding('utf8');response.on('data',chunk=>{text+=chunk;});response.on('error',reject);
          response.on('end',()=>resolve({status:response.statusCode!,headers:new Headers(response.headers as Record<string,string>),text}));
        });
        request.setTimeout(4000,()=>request.destroy(new Error('Bounded HTTP probe timed out.')));request.on('error',reject);
        request.end(payload===undefined?undefined:typeof payload==='string'?payload:JSON.stringify(payload));
      });
    },
    async close(){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));authority.close();}
  };
}

function rawHttp(port:number,payload:string,allowReset=false):Promise<string> {
  return new Promise((resolve,reject)=>{
    let received='';
    const socket=connect({host:'127.0.0.1',port},()=>socket.write(payload));
    socket.setTimeout(3000,()=>socket.destroy(new Error('Bounded raw HTTP probe timed out.')));
    socket.on('data',chunk=>{received+=chunk.toString('utf8');});
    socket.on('end',()=>resolve(received));
    socket.on('error',error=>{
      // A parser may reset instead of finishing its 431 response when the peer
      // is still sending excess header bytes. A healthy follow-up is required.
      if(allowReset&&(error as NodeJS.ErrnoException).code==='ECONNRESET')resolve(received||'[connection-reset]');
      else reject(error);
    });
  });
}

test('security: seat credentials cannot enumerate audits or cross episode boundaries, through any API alias',async()=>{
  const f=await fixture();
  try {
    const first=f.create(),second=f.create(),token=first.seats[0].token;
    for(const prefix of ['/api/v1','/api','']) {
      for(const path of ['/rollouts',`/rollouts/${first.episodeId}`,`/episodes/${first.episodeId}/audit`,
        `/episodes/${first.episodeId}/training`,`/episodes/${first.episodeId}/replay`]) {
        const result=await f.request(prefix+path,token);
        assert.equal(result.status,401,path);
        assert.ok(!result.text.includes(first.seats[1].token));
      }
    }
    assert.equal((await f.request(`/api/v1/episodes/${second.episodeId}/observation`,token)).status,401);
    assert.equal((await f.request(`/api/v1/episodes/${first.episodeId}/observation`,admin)).status,401);
    assert.equal((await f.request(`/api/v1/episodes/${first.episodeId}/truncate`,token,{reason:'Unauthorized truncate.'})).status,401);
    assert.equal((await f.request('/api/v1/episodes',token,{gameId:'take-time',playerCount:3,scenarioId:'official-clock-1-1'})).status,401);
    assert.equal(f.authority.db.prepare('SELECT COUNT(*) AS n FROM observations').get()!.n,0);
    assert.equal(f.authority.db.prepare("SELECT COUNT(*) AS n FROM episodes WHERE status='active'").get()!.n,2);
  } finally {await f.close();}
});

test('security: swapping a player observation and decision token never authorizes another seat',async()=>{
  const f=await fixture();
  try {
    const c=f.create(),a=c.seats[0],b=c.seats[1];
    const seen=JSON.parse((await f.request(`/api/v1/episodes/${c.episodeId}/observation`,b.token)).text);
    const before=f.authority.db.prepare('SELECT state FROM episodes WHERE id=?').get(c.episodeId);
    const attack=await f.request(`/api/v1/episodes/${c.episodeId}/actions`,a.token,
      {observationId:seen.observationId,decisionToken:seen.decisionToken,action:{type:'look_hand'}},{'Idempotency-Key':'swapped-seat'});
    assert.equal(attack.status,409);
    assert.deepEqual(f.authority.db.prepare('SELECT state FROM episodes WHERE id=?').get(c.episodeId),before);
    assert.ok(!attack.text.includes(b.token));
    const own=JSON.parse((await f.request(`/api/v1/episodes/${c.episodeId}/observation`,a.token)).text);
    assert.equal(own.view.hand,null);
  } finally {await f.close();}
});

test('security: DNS rebinding, hostile Origin and forged forwarding headers do not bypass credentials',async()=>{
  const f=await fixture();
  try {
    for(const host of ['attacker.example',`127.0.0.1.attacker.example:${f.port}`,`localhost:${f.port}.attacker.example`]) {
      assert.equal((await f.request('/api/v1/health',undefined,undefined,{Host:host})).status,403);
    }
    for(const origin of ['null','not-a-url','https://attacker.example',`http://localhost:${f.port+1}`,`http://127.0.0.1.attacker.example:${f.port}`]) {
      assert.equal((await f.request('/api/v1/rollouts',admin,undefined,{Origin:origin})).status,403);
    }
    const forwarded={'X-Forwarded-For':'127.0.0.1','X-Real-IP':'127.0.0.1','X-Forwarded-Host':`localhost:${f.port}`,
      'X-Forwarded-Proto':'https','Forwarded':'for=127.0.0.1;proto=https;host=localhost','Tailscale-User-Login':'owner@example.com'};
    assert.equal((await f.request('/api/v1/rollouts',undefined,undefined,forwarded)).status,401);
    assert.equal((await f.request('/api/v1/health',undefined,undefined,{...forwarded,Host:'attacker.example'})).status,403);
    assert.equal((await f.request('/api/v1/health')).status,200);
  } finally {await f.close();}
});

test('security: deeply nested JSON is a bounded client error and cannot reach recursive hashing',async()=>{
  const f=await fixture();
  try {
    const c=f.create();
    // 14 KiB is below the byte cap: nesting must be bounded independently.
    const payload='{"action":'+'['.repeat(7000)+'0'+']'.repeat(7000)+'}';
    const result=await f.request(`/api/v1/episodes/${c.episodeId}/actions`,c.seats[0].token,payload,{'Idempotency-Key':'deep-json'});
    assert.ok([400,413].includes(result.status),`Expected bounded 400/413, received ${result.status}: ${result.text}`);
    assert.equal(f.authority.db.prepare('SELECT COUNT(*) AS n FROM commands').get()!.n,0);
    assert.equal((await f.request('/api/v1/health')).status,200);
  } finally {await f.close();}
});

test('security: malformed and prototype-bearing JSON cannot mutate episode state or poison prototypes',async()=>{
  const f=await fixture();
  try {
    const c=f.create(),token=c.seats[0].token;
    const seen=JSON.parse((await f.request(`/api/v1/episodes/${c.episodeId}/observation`,token)).text);
    const before=f.authority.db.prepare('SELECT state FROM episodes WHERE id=?').get(c.episodeId);
    let index=0;
    for(const value of ['{', 'null','[]','1','"a"',
      JSON.stringify({observationId:seen.observationId,decisionToken:seen.decisionToken,action:JSON.parse('{"type":"look_hand","__proto__":{"securityPoisoned":true}}')})]) {
      const result=await f.request(`/api/v1/episodes/${c.episodeId}/actions`,token,value,{'Idempotency-Key':`invalid-${index++}`});
      assert.ok([400,409,413].includes(result.status),`${value.slice(0,40)}: ${result.status}`);
    }
    assert.equal(({} as any).securityPoisoned,undefined);
    assert.deepEqual(f.authority.db.prepare('SELECT state FROM episodes WHERE id=?').get(c.episodeId),before);
    assert.equal((await f.request('/api/v1/health')).status,200);
  } finally {await f.close();}
});

test('security: a request over the JSON byte cap cannot create an episode',async()=>{
  const f=await fixture();
  try {
    const body=JSON.stringify({gameId:'take-time',playerCount:3,scenarioId:'official-clock-1-1',config:{x:'x'.repeat(65536)}});
    const result=await f.request('/api/v1/episodes',admin,body);
    assert.equal(result.status,413);
    assert.equal(f.authority.db.prepare('SELECT COUNT(*) AS n FROM episodes').get()!.n,0);
    assert.equal((await f.request('/api/v1/health')).status,200);
  } finally {await f.close();}
});

test('security: ambiguous HTTP framing and oversized headers fail closed',async()=>{
  const f=await fixture();
  try {
    const ambiguous=await rawHttp(f.port,`POST /api/v1/episodes HTTP/1.1\r\nHost: 127.0.0.1:${f.port}\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n0\r\n\r\n`);
    assert.match(ambiguous,/^HTTP\/1\.1 400 /);
    const header=await rawHttp(f.port,`GET /health HTTP/1.1\r\nHost: 127.0.0.1:${f.port}\r\nX-Probe: ${'x'.repeat(18000)}\r\nConnection: close\r\n\r\n`,true);
    assert.match(header,/^(HTTP\/1\.1 431 |\[connection-reset\]$)/);
    for(const duplicated of [`Host: 127.0.0.1:${f.port}`,`Authorization: Bearer ${admin}`,`Origin: http://127.0.0.1:${f.port}`,`Idempotency-Key: ambiguity-probe`]) {
      const name=duplicated.split(':')[0].toLowerCase();
      const fixedHost=name==='host'?'':`Host: 127.0.0.1:${f.port}\r\n`;
      const response=await rawHttp(f.port,`GET /api/v1/rollouts HTTP/1.1\r\n${fixedHost}${duplicated}\r\n${duplicated}\r\nConnection: close\r\n\r\n`);
      assert.match(response,/^HTTP\/1\.1 400 /,name);
    }
    assert.equal(f.authority.db.prepare('SELECT COUNT(*) AS n FROM episodes').get()!.n,0);
    assert.equal((await f.request('/api/v1/health')).status,200);
  } finally {await f.close();}
});

test('security: static routes cannot read local secrets and audit text remains JSON data',async()=>{
  const f=await fixture();
  try {
    const c=f.create();
    for(const path of ['/coordinator-token','/connection.json','/data/local-server/coordinator-token','/data/local-server/episodes.sqlite',
      '/src/server.ts','/.env','/env.txt','/%2e%2e/%2e%2e/env.txt','/%2e%2e%2fdata%2flocal-server%2fcoordinator-token']) {
      const response=await f.request(path);
      assert.equal(response.status,404,path);assert.ok(!response.text.includes(admin));
    }
    for(const path of ['/','/play','/app.js','/play.js']) {
      const response=await f.request(path);assert.equal(response.status,200);
      assert.ok(!response.text.includes(admin));assert.ok(!response.text.includes(c.seats[0].token));
      assert.equal(response.headers.get('cache-control'),'no-store');
      if(path==='/'||path==='/play')assert.match(response.headers.get('content-security-policy')??'',/frame-ancestors 'none'/);
    }
    const text='<img src=x onerror="globalThis.securityProbe=1"> <script>alert(document.domain)</script>';
    const posted=await f.request(`/api/v1/rollouts/${c.episodeId}/annotations`,admin,{kind:'review',text});
    assert.equal(posted.status,201);
    const audit=await f.request(`/api/v1/rollouts/${c.episodeId}`,admin);
    assert.match(audit.headers.get('content-type')??'',/^application\/json/);
    assert.equal(audit.headers.get('x-content-type-options'),'nosniff');
    assert.equal(JSON.parse(audit.text).annotations[0].text,text);
    // Browser execution is checked separately; this test verifies transport only.
  } finally {await f.close();}
});
