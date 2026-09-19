import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, unlinkSync, realpathSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Authority, type AuthorityLimits } from './authority.ts';
import { RoomStore } from './room-store.ts';
import { check, exactKeys, RuleError } from './common.ts';
import { games } from './registry.ts';
import { defaultDataDir, coordinatorToken, acquireInstance, writePrivateJson } from './local-settings.ts';
import { AccessControl, type AccessPrincipal, type AccessPermission } from './access-control.ts';
import { HumanAuth, HUMAN_PASSWORD_POLICY, HUMAN_SESSION_SECONDS } from './human-auth.ts';
import { readJsonBody as body, RequestBudget, validateRequestHeaders, securityLogger, type RatePolicy, type SecurityEvent } from './http-security.ts';

function bearer(request:IncomingMessage):string { const match=/^Bearer ([A-Za-z0-9._~+\/-]+=*)$/i.exec(request.headers.authorization??'');return match&&match[1].length<=256?match[1]:''; }
function reply(response:ServerResponse,status:number,value:unknown):void {
  if(response.destroyed || response.writableEnded)return;
  response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  response.end(JSON.stringify(value));
}
async function download(response:ServerResponse,content:ReturnType<Authority['rolloutArtifactContent']>):Promise<void> {
  const {artifact,chunks}=content;
  const encoded=encodeURIComponent(artifact.name.toWellFormed()).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':artifact.byteLength,
    'Content-Disposition':`attachment; filename="artifact-${artifact.id}.bin"; filename*=UTF-8''${encoded}`,
    'Content-Security-Policy':"default-src 'none'; sandbox",'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Artifact-SHA256':artifact.sha256});
  await pipeline(Readable.from(chunks),response);
}
export interface ApiOptions {access?:AccessControl;humanAuth?:HumanAuth;ratePolicy?:Partial<RatePolicy>;audit?:(event:SecurityEvent)=>void;serveWeb?:boolean;}
export function createApi(authority:Authority,adminToken:string,options:ApiOptions={}) {
  check(adminToken.length>=24,'Coordinator token must be at least 24 characters.','INVALID_CONFIG');
  check(adminToken.length<=256 && /^[A-Za-z0-9._~+\/-]+=*$/.test(adminToken),'Coordinator token must use Bearer-compatible characters (base64 or base64url).','INVALID_CONFIG');
  const access=options.access??new AccessControl(),budget=new RequestBudget(options.ratePolicy);
  const rooms=new RoomStore(authority),streams=new Map<string,Set<ServerResponse>>();
  const app=createServer({maxHeaderSize:8192,headersTimeout:10000,requestTimeout:15000,connectionsCheckingInterval:1000},async(request,response)=>{
    let principal:AccessPrincipal|undefined,transport:string|undefined,endpoint='unmatched',errorCode:string|undefined;
    response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('X-Frame-Options','DENY');
    response.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    response.once('finish',()=>{
      // Flood denials are not written per request; bounded files preserve useful audits.
      if(errorCode!=='RATE_LIMITED')try{options.audit?.({at:new Date().toISOString(),method:['GET','POST'].includes(request.method??'')?request.method!:'OTHER',endpoint,status:response.statusCode,...(errorCode?{code:errorCode}:{}),...(principal?{principal:principal.id}:{}),...(transport?{transport}:{})});}catch{}
    });
    try {
      budget.global();validateRequestHeaders(request);
      const listeningPort=(app.address() as any)?.port;
      transport=access.assertRequest(request,listeningPort);
      if(transport==='proxy')response.setHeader('Strict-Transport-Security','max-age=31536000');
      const url=new URL(request.url??'/','http://localhost');
      // Canonical API prefix plus compatibility for the original clients.
      if(url.pathname==='/api/v1'||url.pathname.startsWith('/api/v1/'))url.pathname=url.pathname.slice(7)||'/';
      else if(url.pathname==='/api'||url.pathname.startsWith('/api/'))url.pathname=url.pathname.slice(4)||'/';
      const path=url.pathname.split('/').filter(Boolean), method=request.method;
      // Evaluate after prefix normalization so API aliases cannot expose the UI
      // when this process is configured as a backend-only service.
      if(options.serveWeb!==false && method==='GET' && ['/', '/play'].includes(url.pathname)){
        const content=readFileSync(new URL(url.pathname==='/play'?'../web/play.html':'../web/index.html',import.meta.url));
        response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'"});
        response.end(content);return;
      }
      if(options.serveWeb!==false && method==='GET' && ['/app.js','/style.css','/replay.css','/replay-model.js','/replay-ui.js','/play.js','/play.css','/transport.js'].includes(url.pathname)){
        const content=readFileSync(new URL(`../web${url.pathname}`,import.meta.url));
        response.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
        response.end(content);return;
      }
      budget.credential(bearer(request));
      if(path[0]==='auth'&&path.length===2){
        check(['status','login','account','password','logout'].includes(path[1]),'Unknown endpoint.','NOT_FOUND');
        endpoint=`auth:${path[1]}`;
        if(method==='GET'&&path[1]==='status'){
          reply(response,200,options.humanAuth?.status()??{enabled:false,passwordLoginAvailable:false,sessionTtlSeconds:HUMAN_SESSION_SECONDS,passwordPolicy:HUMAN_PASSWORD_POLICY});return;
        }
        check(options.humanAuth,'Password authentication is unavailable.','FORBIDDEN');
        if(method==='POST'&&path[1]==='login'){reply(response,200,await options.humanAuth.login(await body(request)));return;}
        if(method==='GET'&&path[1]==='account'){reply(response,200,options.humanAuth.account(bearer(request),adminToken));return;}
        if(method==='POST'&&path[1]==='password'){reply(response,200,await options.humanAuth.setPassword(bearer(request),adminToken,await body(request)));return;}
        if(method==='POST'&&path[1]==='logout'){
          const input=await body(request);check(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===0,'Invalid authentication request.','INVALID_REQUEST');
          reply(response,200,options.humanAuth.logout(bearer(request),adminToken));return;
        }
        throw new RuleError('NOT_FOUND','Unknown endpoint.');
      }
      if(method==='GET' && url.pathname==='/health'){endpoint='health';reply(response,200,{ok:true,service:'coop-bench',apiVersion:'v1',build:authority.build});return;}
      if(method==='GET' && url.pathname==='/games'){reply(response,200,{games:[...authority.adapters.values()].map(g=>g.metadata)});return;}
      if(method==='GET' && path[0]==='games' && path.length===2){
        const game=authority.adapters.get(path[1]);check(game,'Unknown game.','NOT_FOUND');reply(response,200,game.metadata);return;
      }
      const authorize=(permission:AccessPermission)=>{
        principal=options.humanAuth?.authorize(bearer(request),adminToken,permission)??access.authorize(bearer(request),adminToken,permission);
        check(!access.sharingEnabled||principal.role!=='coordinator','Use an individual credential while sharing is configured.','FORBIDDEN');
        return principal;
      };
      const historicalOnly=(id:string)=>{
        if(principal?.role==='auditor'){
          const row=authority.db.prepare('SELECT status FROM episodes WHERE id=?').get(id) as {status:string}|undefined;
          check(row,'Unknown episode.','NOT_FOUND');check(row.status!=='active','Auditors can open ended episodes only.','FORBIDDEN');
        }
      };
      if(path[0]==='rooms') {
        endpoint='room';const token=bearer(request),id=path[1],op=path[2];
        if(path.length===1&&method==='GET'){authorize('episode:create');reply(response,200,rooms.list());return;}
        if(path.length===1&&method==='POST'){const who=authorize('episode:create');reply(response,201,rooms.create(who.id,await body(request)));return;}
        if(path.length===2&&method==='GET'){reply(response,200,rooms.observe(id,token));return;}
        if(path.length===3&&op==='admin'&&method==='GET'){authorize('episode:create');reply(response,200,rooms.admin(id));return;}
        if(path.length===3&&method==='POST'){
          const data=await body(request);
          if(op==='join'){reply(response,200,rooms.join(id,token,data));return;}
          if(op==='ready'){reply(response,200,rooms.ready(id,token,data));return;}
          const admin=op.startsWith('admin-');if(admin)authorize('episode:create');
          const operation=admin?op.slice(6):op,memberToken=admin?undefined:token;
          if(operation==='start'){exactKeys(data,[]);reply(response,200,rooms.start(id,memberToken));return;}
          if(operation==='invite'){exactKeys(data,[]);reply(response,200,rooms.invite(id,memberToken));return;}
          if(operation==='kick'){exactKeys(data,['playerId']);reply(response,200,rooms.remove(id,data.playerId,memberToken));return;}
          if(operation==='leave'&&!admin){exactKeys(data,[]);reply(response,200,rooms.remove(id,rooms.observe(id,token).playerId,token,true));return;}
        }
        throw new RuleError('NOT_FOUND','Unknown room endpoint.');
      }
      if(method==='GET'&&url.pathname==='/identity'){
        endpoint='identity';const who=authorize('rollout:read');reply(response,200,{id:who.id,role:who.role,transport,retention:authority.retention()});return;
      }
      const messageQuery=(allowPlayer:boolean)=>{
        const allowed=allowPlayer?['after','limit','playerId']:['after','limit'];
        for(const key of url.searchParams.keys())check(allowed.includes(key)&&url.searchParams.getAll(key).length===1,'Unknown or repeated message filter.','INVALID_REQUEST');
        return {after:Number(url.searchParams.get('after')??-1),limit:Number(url.searchParams.get('limit')??50),playerId:url.searchParams.get('playerId')??undefined};
      };
      if(path[0]==='rollouts'&&path.length===3&&path[2]==='messages'&&method==='GET') {
        endpoint='messages:read';authorize('rollout:read');historicalOnly(path[1]);const query=messageQuery(true);
        budget.credential(bearer(request),true);reply(response,200,authority.listRolloutMessages(path[1],query.playerId,query.after,query.limit));return;
      }
      if(path[0]==='episodes'&&path[2]==='messages') {
        const id=path[1],token=bearer(request);
        if(path.length===3&&method==='GET'){
          endpoint='seat:messages';const query=messageQuery(false);reply(response,200,authority.listSeatMessages(id,token,query.after,query.limit));return;
        }
        if(path.length===3&&method==='POST'){
          endpoint='seat:message-append';reply(response,201,authority.appendMessage(id,token,await body(request)));return;
        }
        if(path.length===4&&path[3]==='complete'&&method==='POST'){
          endpoint='seat:messages-complete';reply(response,200,authority.completeMessages(id,token,await body(request)));return;
        }
      }
      if(path[0]==='rollouts'&&path[2]==='artifacts'&&method==='GET') {
        endpoint='artifact:read';authorize('rollout:read');historicalOnly(path[1]);
        if(path.length===3){reply(response,200,authority.listRolloutArtifacts(path[1]));return;}
        if(path.length===5&&path[4]==='content'){budget.credential(bearer(request),true);await download(response,authority.rolloutArtifactContent(path[1],path[3]));return;}
      }
      if(path[0]==='episodes'&&path[2]==='artifacts') {
        const id=path[1],token=bearer(request);
        if(path.length===3&&method==='GET'){endpoint='seat:artifacts';reply(response,200,authority.listSeatArtifacts(id,token));return;}
        if(path.length===3&&method==='POST'){
          endpoint='seat:artifact-create';const data=await body(request),key=request.headers['idempotency-key'];
          reply(response,201,authority.createArtifact(id,token,typeof key==='string'?key:'',data));return;
        }
        if(path.length===5&&path[4]==='chunks'&&method==='POST'){
          endpoint='seat:artifact-chunk';reply(response,200,authority.putArtifactChunk(id,token,path[3],await body(request)));return;
        }
        if(path.length===5&&path[4]==='complete'&&method==='POST'){
          endpoint='seat:artifact-complete';const data=await body(request);exactKeys(data,[]);budget.credential(token,true);
          reply(response,200,authority.completeArtifact(id,token,path[3]));return;
        }
        if(path.length===5&&path[4]==='content'&&method==='GET'){
          endpoint='seat:artifact-read';budget.credential(token,true);await download(response,authority.seatArtifactContent(id,token,path[3]));return;
        }
      }
      // Human audit APIs are privileged, read stored evidence, and never issue a
      // player observation or advance the game. Player tools keep separate seats.
      if(method==='GET' && url.pathname==='/rollouts'){
        endpoint='rollout:list';authorize('rollout:read');
        for(const key of url.searchParams.keys())check(['limit','offset','status','gameId'].includes(key),'Unknown rollout filter.','INVALID_REQUEST');
        const filters={limit:Number(url.searchParams.get('limit')??50),offset:Number(url.searchParams.get('offset')??0),
          ...(url.searchParams.has('status')?{status:url.searchParams.get('status')!}:{}),
          ...(url.searchParams.has('gameId')?{gameId:url.searchParams.get('gameId')!}:{})};
        reply(response,200,authority.listRollouts(filters));return;
      }
      if(path[0]==='rollouts' && path.length===2 && method==='GET'){
        endpoint='rollout:read';authorize('rollout:read');historicalOnly(path[1]);budget.credential(bearer(request),true);reply(response,200,authority.getRollout(path[1]));return;
      }
      if(path[0]==='rollouts' && path.length===3 && path[2]==='annotations' && method==='POST'){
        endpoint='rollout:annotate';const who=authorize('rollout:annotate');historicalOnly(path[1]);const data=await body(request);exactKeys(data,['kind','playerId','text']);
        check(who.role!=='auditor'||data.kind==='review','Auditors can submit review notes only.','FORBIDDEN');
        reply(response,201,authority.addRolloutAnnotation(path[1],{...data,source:who.source}));return;
      }
      if(method==='POST' && url.pathname==='/episodes'){
        endpoint='episode:create';authorize('episode:create');budget.credential(bearer(request),true);const data=await body(request);exactKeys(data,['gameId','playerCount','scenarioId','config']);
        const created=authority.atomic(()=>{const c=authority.create(data.gameId,{playerCount:data.playerCount,scenarioId:data.scenarioId,...(Object.hasOwn(data,'config')?{config:data.config}:{})});
          if(authority.adapters.get(data.gameId)?.decisionWindow)authority.enableSessionBudget(c.episodeId);return c;});
        reply(response,201,created);return;
      }
      if(path[0]==='episodes' && path.length===3){
        const id=path[1],operation=path[2];
        if(method==='GET'&&operation==='events'){
          endpoint='seat:events';const token=bearer(request);
          for(const key of url.searchParams.keys())check(key==='after'&&url.searchParams.getAll(key).length===1,'Invalid event cursor.','INVALID_REQUEST');
          let cursor=Number(url.searchParams.get('after')??request.headers['last-event-id']??0);
          const first=authority.observe(id,token,cursor),key=`${id}:${first.playerId}`,connections=streams.get(key)??new Set<ServerResponse>();
          check(connections.size<2,'At most two streams per seat.','RESOURCE_LIMIT');
          connections.add(response);streams.set(key,connections);
          response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'});
          response.socket?.setTimeout(0);response.flushHeaders();
          let blockedAt=0;
          response.on('drain',()=>{blockedAt=0;});
          const send=(obs:typeof first)=>{
            cursor=obs.updateCursor??cursor;
            const ok=response.write(`id: ${cursor}\nevent: observation\ndata: ${JSON.stringify({observation:obs,serverTime:authority.clock()})}\n\n`);
            if(!ok)blockedAt=authority.clock();
            if(obs.status!=='active')response.end();
          };
          let pulses=0;
          const timer=setInterval(()=>{
            try{
              if(blockedAt){if(authority.clock()-blockedAt>5000)response.destroy();return;}
              if(authority.seatCursor(id,token)>cursor)send(authority.observe(id,token,cursor));
              else if(++pulses%20===0&&!response.write(`: heartbeat ${authority.clock()}\n\n`))response.destroy();
            }catch{response.destroy();}
          },250);timer.unref();
          response.once('close',()=>{clearInterval(timer);connections.delete(response);if(!connections.size)streams.delete(key);});
          send(first);return;
        }
        if(method==='GET' && operation==='observation'){endpoint='seat:observe';reply(response,200,authority.observe(id,bearer(request),Number(url.searchParams.get('after')??0)));return;}
        if(method==='POST' && operation==='actions'){
          endpoint='seat:act';const data=await body(request), key=request.headers['idempotency-key'];
          const result=authority.submit(id,bearer(request),typeof key==='string'?key:'',data);reply(response,result.status,result.body);return;
        }
        if(method==='POST' && operation==='reflections'){
          endpoint='seat:reflect';const data=await body(request);exactKeys(data,['text']);
          reply(response,201,authority.submitReflection(id,bearer(request),data.text));return;
        }
        if(method==='POST' && operation==='truncate'){
          endpoint='episode:truncate';authorize('episode:truncate');const data=await body(request);exactKeys(data,['reason']);authority.truncate(id,data.reason);reply(response,200,{truncated:true});return;
        }
        if(method==='GET' && ['audit','training','replay'].includes(operation)){
          endpoint=`episode:${operation}`;authorize(operation==='replay'?'episode:replay':'episode:export');budget.credential(bearer(request),true);reply(response,200,operation==='audit'?authority.audit(id):operation==='training'?authority.exportTraining(id):authority.verifyReplay(id));return;
        }
      }
      throw new RuleError('NOT_FOUND','Unknown endpoint.');
    } catch(error) {
      const code=error instanceof RuleError?error.code:'INTERNAL';
      errorCode=code;
      const status=({UNAUTHORIZED:401,FORBIDDEN:403,NOT_FOUND:404,INVALID_REQUEST:400,INVALID_CONFIG:400,TOO_LARGE:413,RATE_LIMITED:429,RESOURCE_LIMIT:429,INTERNAL:500} as Record<string,number>)[code]??409;
      if(status===429)response.setHeader('Retry-After',code==='RESOURCE_LIMIT'?'60':'5');
      if(!request.complete || status===413)response.setHeader('Connection','close');
      if(response.headersSent){response.destroy();return;}
      reply(response,status,{error:{code,message:error instanceof RuleError?error.message:'Internal server error.'}});
    }
  });
  app.maxConnections=64;app.maxRequestsPerSocket=100;app.keepAliveTimeout=5000;app.setTimeout(10000,socket=>socket.destroy());
  const watchdog=setInterval(()=>{
    try{authority.advanceSessions();}catch{options.audit?.({at:new Date().toISOString(),method:'OTHER',endpoint:'session-watchdog',status:500,code:'WATCHDOG_FAILED'});}
  },1000);watchdog.unref();
  app.once('close',()=>{clearInterval(watchdog);for(const group of streams.values())for(const response of group)response.destroy();streams.clear();});
  return app;
}

export interface LocalAppOptions {
  dataDir?:string; dbPath?:string; adminToken?:string; port?:number; fallbackPort?:boolean;
  usersFile?:string;trustedProxyOrigin?:string;serveWeb?:boolean;
  limits?:Partial<AuthorityLimits>;
}
/** Embedded by the desktop shell, or run headlessly with precisely the same API. */
export async function startLocalApp(options:LocalAppOptions={}) {
  const dataDir=resolve(options.dataDir??defaultDataDir());
  const port=options.port??8788;
  check(Number.isInteger(port)&&port>=0&&port<=65535,'Port must be between 0 and 65535.','INVALID_CONFIG');
  const release=acquireInstance(dataDir);
  let authority:Authority|undefined,humanAuth:HumanAuth|undefined,app:ReturnType<typeof createApi>|undefined;
  const discoveryPath=join(dataDir,'connection.json');
  try {
    const dbPath=resolve(options.dbPath??join(dataDir,'episodes.sqlite'));
    mkdirSync(dirname(dbPath),{recursive:true});
    const adminToken=coordinatorToken(dataDir,options.adminToken);
    const usersFile=options.usersFile??join(dataDir,'access-users.json');
    const access=new AccessControl({usersFile,optionalMissingUsersFile:options.usersFile===undefined,trustedProxyOrigin:options.trustedProxyOrigin});
    if(access.humanPasswordEnabled)humanAuth=new HumanAuth(join(dataDir,'human-auth.sqlite'),access);
    authority=new Authority(dbPath,games,undefined,undefined,options.limits);app=createApi(authority,adminToken,{access,humanAuth,
      serveWeb:options.serveWeb??process.env.COOP_API_ONLY!=='1',audit:securityLogger(join(dataDir,'security-audit.jsonl'))});
    const listen=(p:number)=>new Promise<void>((resolve,reject)=>{
      const failed=(error:Error)=>{app!.off('listening',ready);reject(error);};
      const ready=()=>{app!.off('error',failed);resolve();};
      app!.once('error',failed);app!.once('listening',ready);app!.listen(p,'127.0.0.1');
    });
    try{await listen(port);}catch(error){
      if((error as NodeJS.ErrnoException).code!=='EADDRINUSE'||!options.fallbackPort)throw error;
      await listen(0);
    }
    const baseUrl=`http://127.0.0.1:${(app.address() as any).port}`,apiUrl=`${baseUrl}/api/v1`;
    writePrivateJson(discoveryPath,{version:1,apiUrl,baseUrl,pid:process.pid,dbPath});
    let closing:Promise<void>|undefined;
    const close=()=>closing??=(async()=>{
      // Stop sockets, then drain bounded async password KDF jobs before closing databases.
      const stopped=new Promise<void>(resolve=>app!.close(()=>resolve()));
      app!.closeAllConnections();await stopped;
      await humanAuth?.close();
      authority!.close();
      try{unlinkSync(discoveryPath);}catch{}
      release();
    })();
    return {baseUrl,apiUrl,adminToken,dbPath,discoveryPath,close};
  }catch(error){
    if(app?.listening){app.close();app.closeAllConnections();}
    await humanAuth?.close();
    authority?.close();release();throw error;
  }
}
if(process.argv[1] && !process.argv[1].startsWith('-') && existsSync(resolve(process.argv[1])) && import.meta.url===pathToFileURL(realpathSync(resolve(process.argv[1]))).href){
  startLocalApp({dataDir:process.env.COOP_DATA_DIR,dbPath:process.env.COOP_DB,adminToken:process.env.COOP_ADMIN_TOKEN,
    usersFile:process.env.COOP_USERS_FILE,trustedProxyOrigin:process.env.COOP_TRUSTED_PROXY_ORIGIN,
    limits:{...(process.env.COOP_MAX_ARTIFACT_BYTES?{maxArtifactBytes:Number(process.env.COOP_MAX_ARTIFACT_BYTES)}:{}),
      ...(process.env.COOP_MAX_ARTIFACTS_PER_SEAT?{maxArtifactsPerSeat:Number(process.env.COOP_MAX_ARTIFACTS_PER_SEAT)}:{}),
      ...(process.env.COOP_MAX_ARTIFACT_STORAGE_BYTES?{maxArtifactStoredBytesTotal:Number(process.env.COOP_MAX_ARTIFACT_STORAGE_BYTES)}:{}),
      ...(process.env.COOP_MAX_MESSAGE_BYTES?{maxMessageBytes:Number(process.env.COOP_MAX_MESSAGE_BYTES)}:{}),
      ...(process.env.COOP_MAX_MESSAGES_PER_SEAT?{maxMessagesPerSeat:Number(process.env.COOP_MAX_MESSAGES_PER_SEAT)}:{}),
      ...(process.env.COOP_MAX_MESSAGE_STORAGE_BYTES?{maxMessageStoredBytesTotal:Number(process.env.COOP_MAX_MESSAGE_STORAGE_BYTES)}:{}),
      ...(process.env.COOP_MAX_ROLLOUT_STORAGE_BYTES?{maxStoredBytesTotal:Number(process.env.COOP_MAX_ROLLOUT_STORAGE_BYTES)}:{}),
      ...(process.env.COOP_MAX_EPISODES?{maxEpisodes:Number(process.env.COOP_MAX_EPISODES)}:{})},
    port:Number(process.env.PORT??8788)}).then(local=>{
    console.log(`Coop Bench: ${local.baseUrl}\nAgent API: ${local.apiUrl}\nSQLite: ${local.dbPath}\nCoordinator credential: local coordinator-token file or supplied environment (not printed).`);
    const stop=()=>local.close().then(()=>process.exit(0));process.on('SIGINT',stop);process.on('SIGTERM',stop);
  }).catch(error=>{console.error(`Coop Bench could not start: ${error.message}`);process.exitCode=1;});
}
