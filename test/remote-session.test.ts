import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConnectionStore, DEFAULT_API, RemoteSession, normalizeApiUrl, validateRequest, publicConnectionError } from '../desktop/remote-session.mjs';

const TOKEN_A='test-human-credential-AAAAAAAAAAAA',TOKEN_B='test-human-credential-BBBBBBBBBBBB';
const decode=(response:any)=>JSON.parse(new TextDecoder().decode(response.bytes));
const request=(id:string,path='/api/v1/rollouts')=>({id,path,method:'GET'});
const json=(response:any,value:any,status=200)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(value));};
function deferred(){let resolve!:(value?:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
function memoryStore(apiUrl=DEFAULT_API){return {value:{apiUrl} as any,load(){return structuredClone(this.value);},save(apiUrl:string,token:string,remember:boolean){this.value={apiUrl,...(remember?{token}:{})};}};}
async function fixture(t:any,custom?:(req:any,res:any)=>Promise<boolean>|boolean){
  const requests:any[]=[];
  const server=createServer(async(req,res)=>{
    requests.push({path:req.url,authorization:req.headers.authorization,method:req.method});
    try {
      if(await custom?.(req,res))return;
      const path=new URL(req.url!,'http://local.invalid').pathname;
      if(path==='/api/v1/health')return json(res,{ok:true,service:'coop-bench',apiVersion:'v1'});
      if(path==='/api/v1/identity')return json(res,{id:'tester',role:'operator',transport:'local',token:'not-a-public-identity-field'});
      if(path==='/api/v1/games')return json(res,{games:[]});
      return json(res,{items:[],total:0});
    }catch{if(!res.destroyed)json(res,{error:'fixture failure'},500);}
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  return {apiUrl:`http://127.0.0.1:${(server.address() as any).port}/api/v1`,requests};
}
function encryption(){
  // Exercise ciphertext round-trips through the same API as safeStorage without
  // consulting the developer's OS keychain or real saved credentials.
  const key=randomBytes(32);let available=true;
  return {setAvailable:(value:boolean)=>available=value,isEncryptionAvailable:()=>available,
    encryptString(text:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(text,'utf8'),cipher.final(),cipher.getAuthTag()]);},
    decryptString(bytes:Buffer){const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(-16));return Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString('utf8');}};
}

test('remote API URLs require HTTPS except loopback and human IPC routes stay restricted',()=>{
  assert.equal(normalizeApiUrl('https://coop.neutrinophysics.cn:34935/'),DEFAULT_API);
  assert.equal(normalizeApiUrl('https://coop.neutrinophysics.cn/'),'https://coop.neutrinophysics.cn/api/v1');
  assert.equal(normalizeApiUrl('http://127.0.0.1:8888/api/v1/'),'http://127.0.0.1:8888/api/v1');
  for(const url of ['http://example.com','file:///api/v1','https://user:secret@example.com/api/v1','https://example.com/api/v1?x=1','https://example.com/#secret','https://example.com/else','https://example.com\\@else'])assert.throws(()=>normalizeApiUrl(url),url);
  for(const path of ['/api/v1/games','/api/v1/rollouts/e-1/messages?playerId=p1&after=-1','/api/v1/rollouts/e-1/artifacts/a-1/content','/api/v1/episodes/e-1/replay'])assert.equal(validateRequest(request('r',path)).path,path);
  for(const path of ['https://else/api/v1/games','//else/api/v1/games','/api/v1/../identity','/api/v1/%2e%2e/identity','/api/v1/games#fragment','/api/v1/games?x=1\r\nAuthorization:x','/api/v1/games\\other','/api/v1/play','/api/v1/episodes/e-1/observation','/api/v1/episodes/e-1/messages'])assert.throws(()=>validateRequest(request('r',path)),path);
  assert.throws(()=>validateRequest({...request('r'),headers:{Authorization:TOKEN_A}}));
  assert.throws(()=>validateRequest({...request('r'),method:'DELETE'}));
  assert.throws(()=>validateRequest({...request('r'),body:{}}));
  assert.throws(()=>validateRequest({id:'r',path:'/api/v1/episodes/e/actions',method:'POST',body:{}}));
  assert.throws(()=>validateRequest({id:'r',path:'/api/v1/episodes',method:'POST',body:{text:'a'.repeat(65536)}}));
});

test('real HTTP transport authenticates private routes, omits tokens for public reads, and exposes no credential in connection metadata',async t=>{
  const f=await fixture(t),store=memoryStore(f.apiUrl),session=new RemoteSession({fetcher:fetch,store});
  assert.deepEqual(decode(await session.request(request('catalog','/api/v1/games'))),{games:[]});
  await assert.rejects(session.request(request('private-before-login')),/先连接/);
  const descriptor=await session.connect({apiUrl:f.apiUrl,token:TOKEN_A,remember:false});
  assert.equal(descriptor.connected,true);assert.equal(descriptor.identity.id,'tester');
  assert.equal('token' in descriptor,false);assert.equal('token' in descriptor.identity,false);
  descriptor.identity.role='auditor';assert.equal(session.descriptor().identity.role,'operator');
  assert.equal(JSON.stringify(store.value).includes(TOKEN_A),false);
  assert.equal(decode(await session.request(request('private'))).total,0);
  await session.request(request('public-again','/api/v1/games'));
  assert.ok(f.requests.filter(r=>/\/health|\/games/.test(r.path)).every(r=>r.authorization===undefined));
  assert.equal(f.requests.find(r=>r.path==='/api/v1/identity').authorization,`Bearer ${TOKEN_A}`);
  assert.equal(f.requests.find(r=>r.path==='/api/v1/rollouts').authorization,`Bearer ${TOKEN_A}`);
  assert.equal(session.pending.size,0);
});

test('redirects never forward a credential to the redirect destination',async t=>{
  const destination=await fixture(t);
  const source=await fixture(t,(req,res)=>{if(req.url==='/api/v1/rollouts'){res.writeHead(302,{Location:destination.apiUrl+'/rollouts'});res.end();return true;}return false;});
  const session=new RemoteSession({fetcher:fetch,store:memoryStore(source.apiUrl)});
  await session.connect({apiUrl:source.apiUrl,token:TOKEN_A});
  await assert.rejects(session.request(request('redirect')));
  assert.equal(destination.requests.length,0);
  assert.equal(source.requests.at(-1).authorization,`Bearer ${TOKEN_A}`);
  assert.equal(session.pending.size,0);
});

test('rate-limited artifact reads preserve Retry-After through IPC without forwarding private headers',async t=>{
  const f=await fixture(t,(req,res)=>{if(req.url.endsWith('/content')){res.writeHead(429,{'Content-Type':'application/json','Retry-After':'5','Set-Cookie':'private=must-not-escape','X-Private':'must-not-escape'});res.end('{"error":{"code":"RATE_LIMITED"}}');return true;}return false;});
  const session=new RemoteSession({fetcher:fetch,store:memoryStore(f.apiUrl)});await session.connect({apiUrl:f.apiUrl,token:TOKEN_A});
  const response=await session.request(request('artifact-retry','/api/v1/rollouts/e/artifacts/a/content'));
  assert.equal(response.status,429);assert.equal(response.headers['retry-after'],'5');assert.equal(response.headers['set-cookie'],undefined);assert.equal(response.headers['x-private'],undefined);
  assert.equal(f.requests.at(-1).authorization,`Bearer ${TOKEN_A}`);assert.equal(session.pending.size,0);
});

test('HTML interception and oversized declared/chunked responses are rejected, including artifact HTML',async t=>{
  const f=await fixture(t,(req,res)=>{
    if(req.url==='/api/v1/rollouts/html'||req.url==='/api/v1/rollouts/e/artifacts/html/content'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<h1>intercepted</h1>');return true;}
    if(req.url==='/api/v1/rollouts/type'){res.writeHead(200,{'Content-Type':'application/json-evil'});res.end('{}');return true;}
    if(req.url==='/api/v1/rollouts/declared'){res.writeHead(200,{'Content-Type':'application/json','Content-Length':'4097'});res.end('x'.repeat(4097));return true;}
    if(req.url==='/api/v1/rollouts/chunked'){res.writeHead(200,{'Content-Type':'application/json'});res.write('x'.repeat(3000));res.end('x'.repeat(3000));return true;}
    if(req.url==='/api/v1/rollouts/e/artifacts/valid/content'){res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end(Buffer.from([0,255,1]));return true;}
    return false;
  });
  const session=new RemoteSession({fetcher:fetch,store:memoryStore(f.apiUrl),maxResponse:4096});
  await session.connect({apiUrl:f.apiUrl,token:TOKEN_A});
  for(const path of ['html','type','declared','chunked'])await assert.rejects(session.request(request(path,`/api/v1/rollouts/${path}`)));
  await assert.rejects(session.request(request('artifact-html','/api/v1/rollouts/e/artifacts/html/content')),/API 响应/);
  assert.deepEqual((await session.request(request('binary','/api/v1/rollouts/e/artifacts/valid/content'))).bytes,new Uint8Array([0,255,1]));
  assert.equal(session.pending.size,0);
});

test('server switching aborts old traffic and only the new credential reaches the new server',async t=>{
  const received=deferred(),release=deferred();
  const a=await fixture(t,async(req,res)=>{if(req.url==='/api/v1/rollouts/slow'){received.resolve();await release.promise;json(res,{old:true});return true;}return false;});
  const b=await fixture(t),session=new RemoteSession({fetcher:fetch,store:memoryStore(a.apiUrl)});
  await session.connect({apiUrl:a.apiUrl,token:TOKEN_A});const oldEpoch=session.epoch;
  const old=session.request(request('slow','/api/v1/rollouts/slow')).catch((e:any)=>e);
  await received.promise;await session.connect({apiUrl:b.apiUrl,token:TOKEN_B});release.resolve();
  assert.ok(await old instanceof Error);assert.equal(session.descriptor().apiUrl,b.apiUrl);assert.equal(session.descriptor().connected,true);
  const before=a.requests.length;
  await assert.rejects(session.wire(a.apiUrl,TOKEN_A,request('stale-wire','/api/v1/identity'),oldEpoch),/旧请求/);
  assert.equal(a.requests.length,before);
  assert.ok(b.requests.every(r=>r.authorization===undefined||r.authorization===`Bearer ${TOKEN_B}`));
  assert.equal(session.pending.size,0);
});

test('switch between old health and identity cannot send the old token or overwrite the new login',async t=>{
  const a=await fixture(t),b=await fixture(t),session=new RemoteSession({fetcher:fetch,store:memoryStore(a.apiUrl)});
  const wire=session.wire.bind(session);let switched=false;
  session.wire=async(...args:any[])=>{const response=await wire(...args);if(!switched&&args[0]===a.apiUrl&&args[2].path==='/api/v1/health'){switched=true;await session.connect({apiUrl:b.apiUrl,token:TOKEN_B});}return response;};
  await assert.rejects(session.connect({apiUrl:a.apiUrl,token:TOKEN_A}),/旧请求/);
  assert.equal(a.requests.some(r=>r.authorization!==undefined),false);
  assert.equal(session.descriptor().apiUrl,b.apiUrl);assert.equal(session.descriptor().connected,true);
});

test('a completed old 401 cannot log out a connection switched before its continuation',async t=>{
  const a=await fixture(t,(req,res)=>{if(req.url==='/api/v1/rollouts'){json(res,{error:'expired'},401);return true;}return false;});
  const b=await fixture(t),session=new RemoteSession({fetcher:fetch,store:memoryStore(a.apiUrl)});
  await session.connect({apiUrl:a.apiUrl,token:TOKEN_A});const wire=session.wire.bind(session);
  session.wire=async(...args:any[])=>{const response=await wire(...args);if(args[2].id==='stale-401')await session.connect({apiUrl:b.apiUrl,token:TOKEN_B});return response;};
  await assert.rejects(session.request(request('stale-401')),/旧响应/);
  assert.equal(session.descriptor().apiUrl,b.apiUrl);assert.equal(session.descriptor().connected,true);
});

test('explicit cancellation and logout cancel pending requests; logout forgets remembered credentials',async t=>{
  const arrivals=new Map<string,ReturnType<typeof deferred>>(),releases=new Map<string,ReturnType<typeof deferred>>();
  for(const id of ['cancel','logout']){arrivals.set(id,deferred());releases.set(id,deferred());}
  const f=await fixture(t,async(req,res)=>{const id=req.url?.split('/').at(-1);if(arrivals.has(id)){arrivals.get(id)!.resolve();await releases.get(id)!.promise;json(res,{});return true;}return false;});
  const store=memoryStore(f.apiUrl),session=new RemoteSession({fetcher:fetch,store});
  await session.connect({apiUrl:f.apiUrl,token:TOKEN_A,remember:true});
  for(const id of ['cancel','logout']){
    const pending=session.request(request(id,`/api/v1/rollouts/${id}`)).catch((e:any)=>e);await arrivals.get(id)!.promise;
    if(id==='cancel')session.cancel(id);else session.disconnect();
    releases.get(id)!.resolve();assert.ok(await pending instanceof Error);
  }
  assert.equal(session.descriptor().connected,false);assert.equal(session.descriptor().remembered,false);assert.equal(store.value.token,undefined);assert.equal(session.pending.size,0);
});

test('timeouts release pending requests and do not automatically retry',async t=>{
  const release=deferred();const f=await fixture(t,async(req,res)=>{if(req.url==='/api/v1/games'){await release.promise;json(res,{games:[]});return true;}return false;});
  const session=new RemoteSession({fetcher:fetch,store:memoryStore(f.apiUrl),timeoutMs:20});
  await assert.rejects(session.request(request('timeout','/api/v1/games')),(e:any)=>e.code==='TIMEOUT' && /请求超时/.test(e.message));release.resolve();
  assert.equal(f.requests.length,1);assert.equal(session.pending.size,0);
});

test('persistent ciphertext is bound to the normalized API, unavailable encryption fails closed, and not-remembering erases the saved secret',()=>{
  const file=join(mkdtempSync(join(tmpdir(),'coop-remote-store-')),'connection.json'),crypto=encryption(),store=new ConnectionStore(file,crypto);
  const api='https://api.example.com/api/v1';
  store.save(api,TOKEN_A,true);const encrypted=readFileSync(file,'utf8');assert.equal(encrypted.includes(TOKEN_A),false);
  assert.deepEqual(store.load(),{apiUrl:api,token:TOKEN_A});
  const tampered=JSON.parse(encrypted);tampered.apiUrl='https://other.example.com/api/v1';writeFileSync(file,JSON.stringify(tampered));
  assert.equal(store.load().token,undefined);
  writeFileSync(file,encrypted);crypto.setAvailable(false);assert.deepEqual(store.load(),{apiUrl:api});
  assert.throws(()=>store.save(api,TOKEN_B,true),/安全存储不可用/);
  store.save(api,TOKEN_B,false);assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),{schema:'coop-client-connection/v1',apiUrl:api});
  crypto.setAvailable(true);assert.equal(store.load().token,undefined);
});

test('remembering with unavailable encryption cannot commit a connected session; an explicit memory-only retry succeeds',async t=>{
  const f=await fixture(t),crypto=encryption();crypto.setAvailable(false);
  const store=new ConnectionStore(join(mkdtempSync(join(tmpdir(),'coop-remote-unavailable-')),'connection.json'),crypto),session=new RemoteSession({fetcher:fetch,store});
  await assert.rejects(session.connect({apiUrl:f.apiUrl,token:TOKEN_A,remember:true}),/安全存储不可用/);
  assert.equal(session.descriptor().connected,false);assert.equal(store.load().token,undefined);
  assert.equal((await session.connect({apiUrl:f.apiUrl,token:TOKEN_A,remember:false})).connected,true);
  assert.equal(store.load().token,undefined);
});

test('saved connection restore reports failure without exposing token, and later success clears the stale error',async t=>{
  let offline=true;
  const f=await fixture(t,(req,res)=>{if(offline&&req.url==='/api/v1/health'){res.writeHead(200,{'Content-Type':'text/html'});res.end('intercepted');return true;}return false;});
  const store=memoryStore(f.apiUrl);store.value.token=TOKEN_A;const session=new RemoteSession({fetcher:fetch,store});
  const failed=await session.restore();assert.equal(failed.connected,false);assert.equal(failed.connectionError.code,'INVALID_API_RESPONSE');assert.match(failed.connectionError.message,/API 响应/);assert.equal(JSON.stringify(failed).includes(TOKEN_A),false);
  offline=false;await session.connect({apiUrl:f.apiUrl,token:TOKEN_B});assert.equal((await session.restore()).connectionError,undefined);
  for(const token of ['too-short','a'.repeat(257),'x'.repeat(25)+'\nHeader:value','x'.repeat(25)+' spaced'])await assert.rejects(session.connect({apiUrl:f.apiUrl,token}));
});

test('connection diagnostics distinguish API credentials, gateway authentication, unavailable service and wrong endpoints',async t=>{
  const cases=[
    {path:'health',status:401,type:'text/html',auth:'Basic realm="private"',code:'PROXY_AUTH_REQUIRED'},
    {path:'identity',status:401,type:'text/html',auth:'Basic realm="private"',code:'PROXY_AUTH_REQUIRED'},
    {path:'health',status:401,type:'application/json',code:'PROXY_AUTH_REQUIRED'},
    {path:'identity',status:401,type:'application/json',code:'AUTH_REJECTED'},
    {path:'identity',status:403,type:'application/json',code:'PERMISSION_DENIED'},
    {path:'identity',status:503,type:'application/json',code:'API_UNAVAILABLE'},
    {path:'health',status:502,type:'text/html',code:'API_UNAVAILABLE'},
    {path:'health',status:404,type:'application/json',code:'INCOMPATIBLE_API'},
    {path:'health',status:200,type:'text/html',code:'INVALID_API_RESPONSE'},
  ];
  for(const scenario of cases){
    const f=await fixture(t,(req,res)=>{
      if(req.url!==`/api/v1/${scenario.path}`)return false;
      res.writeHead(scenario.status,{'Content-Type':scenario.type,...(scenario.auth?{'WWW-Authenticate':scenario.auth}:{})});
      res.end(scenario.type==='application/json'?JSON.stringify({error:`private-server-body-${TOKEN_A}`}):`<html>${TOKEN_A}</html>`);return true;
    });
    const session=new RemoteSession({fetcher:fetch,store:memoryStore(f.apiUrl)});
    await assert.rejects(session.connect({apiUrl:f.apiUrl,token:TOKEN_A}),(e:any)=>{
      assert.equal(e.code,scenario.code);assert.equal(e.status,scenario.status);
      assert.equal(JSON.stringify(publicConnectionError(e)).includes(TOKEN_A),false);return true;
    });
    assert.equal(session.descriptor().connected,false);assert.equal(session.pending.size,0);
    if(scenario.path==='health')assert.equal(f.requests.some(r=>r.authorization!==undefined),false);
  }
});

test('Node and Electron network exceptions produce safe specific diagnostics, never a password verdict',async()=>{
  for(const [code,expected] of [['ECONNREFUSED','CONNECTION_REFUSED'],['net::ERR_CONNECTION_REFUSED','CONNECTION_REFUSED'],['ENOTFOUND','DNS_ERROR'],['net::ERR_NAME_NOT_RESOLVED','DNS_ERROR'],['CERT_HAS_EXPIRED','TLS_ERROR'],['net::ERR_SSL_PROTOCOL_ERROR','TLS_ERROR'],['ECONNRESET','NETWORK_UNREACHABLE']]){
    for(const nested of [false,true]){
      const raw=Object.assign(new Error(`${code} private ${TOKEN_A}`),{code});
      const error=nested?new TypeError('fetch failed',{cause:raw}):raw;
      const session=new RemoteSession({fetcher:async()=>{throw error;},store:memoryStore()});
      await assert.rejects(session.connect({apiUrl:DEFAULT_API,token:TOKEN_A}),(e:any)=>{
        const safe=publicConnectionError(e);assert.equal(safe.code,expected);assert.equal(JSON.stringify(safe).includes(TOKEN_A),false);assert.doesNotMatch(safe.message,/凭证无效|密码错误/);return true;
      });
      assert.equal(session.pending.size,0);
    }
  }
  assert.equal(JSON.stringify(publicConnectionError(new Error(`private ${TOKEN_A}`))).includes(TOKEN_A),false);
});

test('authentication expiry clears the session but ordinary permission errors keep it',async t=>{
  let status=403;
  const f=await fixture(t,(req,res)=>{if(req.url==='/api/v1/rollouts'){json(res,{error:'denied'},status);return true;}return false;});
  const store=memoryStore(f.apiUrl),session=new RemoteSession({fetcher:fetch,store});
  await session.connect({apiUrl:f.apiUrl,token:TOKEN_A,remember:true});
  assert.equal((await session.request(request('permission'))).status,403);assert.equal(session.descriptor().connected,true);
  status=401;
  assert.equal((await session.request(request('expired'))).status,401);assert.equal(session.descriptor().connected,false);assert.equal(store.value.token,undefined);
});
