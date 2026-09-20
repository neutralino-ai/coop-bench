import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const transportSource=readFileSync(new URL('../web/transport.js',import.meta.url),'utf8');
const appSource=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
function deferred(){let resolve:any,reject:any;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function transportContext(bridge:any,fetchImpl:any=()=>{throw Error('Renderer must not fetch in desktop mode');},timers:any={setTimeout,clearTimeout}){
 const context=vm.createContext({window:{coopDesktop:bridge},location:{origin:'http://127.0.0.1:8788'},crypto:webcrypto,fetch:fetchImpl,URL,Response,Uint8Array,DOMException,AbortController,AbortSignal,TextEncoder,...timers,navigator:{clipboard:{writeText:async()=>{}}}});
 vm.runInContext(transportSource,context);return context.window.coopTransport;
}
const identity={id:'fixture-user',role:'operator'};
const connection={mode:'remote',apiUrl:'https://example.test/api/v1',connected:true,identity,remembered:false};

test('read-only rate-limit retries are bounded; writes are never automatically retried',async()=>{
 let calls=0;const delays:number[]=[];
 const api=transportContext({connect:async()=>connection,request:async()=>({status:++calls<3?429:200,headers:{},bytes:new Uint8Array()}),cancelRequest:async()=>{}},undefined,{setTimeout:(f:any,ms:number)=>{delays.push(ms);return setTimeout(f,0);},clearTimeout});
 assert.equal((await api.request('/api/v1/games')).status,200);assert.equal(calls,3);assert.deepEqual(delays,[3200,6400]);
 calls=0;assert.equal((await api.request('/api/v1/episodes',{method:'POST',body:{}})).status,429);assert.equal(calls,1);
 const blocked=transportContext({connect:async()=>connection,request:async()=>({status:429,headers:{},bytes:new Uint8Array()}),cancelRequest:async()=>{}},undefined,{setTimeout:(f:any)=>setTimeout(f,0),clearTimeout});
 assert.equal((await blocked.request('/api/v1/games')).status,429);
});
test('logout cancels rate-limit waiting without sending another request as the next user',async()=>{
 const entered=deferred();let calls=0;
 const api=transportContext({connect:async()=>connection,request:async()=>{calls++;return {status:429,headers:{},bytes:new Uint8Array()};},cancelRequest:async()=>{},disconnect:async()=>{}},undefined,{setTimeout:(f:any)=>{entered.resolve();return setTimeout(f,30000);},clearTimeout});
 const pending=api.request('/api/v1/games');await entered.promise;await api.disconnect();await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
});

test('artifact GET honors numeric and HTTP-date Retry-After, preserves bytes and rejects excessive waits',async()=>{
 for(const retryAfter of ['5',new Date(Date.now()+10000).toUTCString()]){
  let calls=0;const delays:number[]=[];
  const api=transportContext({request:async()=>++calls===1?{status:429,headers:{'retry-after':retryAfter},bytes:new Uint8Array()}:{status:200,headers:{'content-type':'application/octet-stream'},bytes:new Uint8Array([0,255,8])},connect:async()=>connection,cancelRequest:async()=>{}},undefined,{setTimeout:(fn:any,ms:number)=>{delays.push(ms);return setTimeout(fn,0);},clearTimeout});
  const result=await api.request('/api/v1/rollouts/e/artifacts/a/content');assert.deepEqual([...new Uint8Array(await result.arrayBuffer())],[0,255,8]);assert.equal(calls,2);
  assert.equal(delays.length,1);if(retryAfter==='5')assert.equal(delays[0],5000);else assert.ok(delays[0]>8000&&delays[0]<=10000);
 }
 let calls=0,timers=0;const api=transportContext({request:async()=>{calls++;return {status:429,headers:{'retry-after':'120'},bytes:new Uint8Array()};},connect:async()=>connection,cancelRequest:async()=>{}},undefined,{setTimeout:()=>{timers++;throw Error('Must not retry earlier than requested.');},clearTimeout});
 assert.equal((await api.request('/api/v1/rollouts/e/artifacts/a/content')).status,429);assert.equal(calls,1);assert.equal(timers,0);
});

test('switching server cancels rate-limited artifact backoff instead of replaying it with the new session',async()=>{
 const entered=deferred();let calls=0;
 const api=transportContext({request:async()=>{calls++;return {status:429,headers:{'retry-after':'5'},bytes:new Uint8Array()};},connect:async()=>({...connection,apiUrl:'https://new.example.test/api/v1'}),cancelRequest:async()=>{}},undefined,{setTimeout:(fn:any)=>{entered.resolve();return setTimeout(fn,30000);},clearTimeout});
 const controller=new AbortController(),pending=api.request('/api/v1/rollouts/e/artifacts/a/content',{signal:controller.signal});await entered.promise;
 await api.connect({apiUrl:'https://new.example.test/api/v1',token:'synthetic-new-account'});await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
});

test('desktop transport keeps credentials inside connect and preserves binary response bytes',async()=>{
 const requests:any[]=[];const api=transportContext({connect:async(value:any)=>{assert.equal(value.token,'fixture-token');return {...connection,adminToken:'must-not-escape'};},request:async(value:any)=>{requests.push(value);return {status:200,headers:{'content-type':'application/octet-stream'},bytes:new Uint8Array([0,255,8,128])};},cancelRequest:async()=>{},getConnection:async()=>connection,disconnect:async()=>{}});
 const info=await api.connect({apiUrl:connection.apiUrl,token:'fixture-token',remember:false});assert.equal(info.adminToken,undefined);
 const response=await api.request('/api/v1/rollouts/fixture/artifacts/fixture/content');assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[0,255,8,128]);assert.equal(requests[0].headers,undefined);assert.equal(requests[0].token,undefined);
 await assert.rejects(api.request('/api/v1/episodes/fixture/observation',{seatToken:'fixture-seat'}),/人工访问权限/);
 await assert.rejects(api.request('https://elsewhere.test/api/v1/games'),/API 路径/);
 await assert.rejects(api.request('/api/v1/../identity'),/无效/);
});

test('desktop transport aborts requests, cancels bridge work, and drops stale connection replies',async()=>{
 const pending=deferred(),login=deferred(),cancelled:string[]=[];
 const api=transportContext({connect:()=>login.promise,request:()=>pending.promise,cancelRequest:async(id:string)=>cancelled.push(id),disconnect:async()=>{},getConnection:async()=>connection});
 const controller=new AbortController();const result=api.request('/api/v1/games',{signal:controller.signal});controller.abort();await assert.rejects(result,{name:'AbortError'});assert.equal(cancelled.length,1);
 const attempt=api.connect({token:'fixture'});await api.disconnect();login.resolve(connection);await assert.rejects(attempt,{name:'AbortError'});assert.equal((await api.getConnection()).adminToken,undefined);
 pending.resolve({status:200,headers:{},bytes:new Uint8Array()});
});

test('structured bridge errors retain auth/proxy classifications across context isolation',async()=>{
 const rejected={__coopClientError:{code:'AUTH_REJECTED',message:'个人凭证无效。',status:401}};const proxy={__coopClientError:{code:'PROXY_AUTH_REQUIRED',message:'代理要求额外认证。',status:401}};
 const api=transportContext({getConnection:async()=>rejected,connect:async()=>rejected,request:async()=>proxy,cancelRequest:async()=>{},disconnect:async()=>proxy,copyText:async()=>proxy});
 await assert.rejects(api.getConnection(),{code:'AUTH_REJECTED',status:401});await assert.rejects(api.connect({token:'synthetic'}),{code:'AUTH_REJECTED',status:401});await assert.rejects(api.request('/api/v1/identity'),{code:'PROXY_AUTH_REQUIRED',status:401});await assert.rejects(api.disconnect(),{code:'PROXY_AUTH_REQUIRED'});await assert.rejects(api.copyText('fixture'),{code:'PROXY_AUTH_REQUIRED'});
});

test('browser transport stays same-origin, uses memory credentials and allows explicit seat authorization',async()=>{
 const requests:any[]=[];const api=transportContext(undefined,async(url:any,options:any)=>{requests.push({url,options});return Response.json(identity);});
 await assert.rejects(api.connect({apiUrl:'https://elsewhere.test/api/v1',token:'fixture'}),/同源/);assert.equal(requests.length,0);
 await api.connect({token:'human-fixture'});await api.request('/api/v1/episodes/fixture/actions',{method:'POST',seatToken:'seat-fixture',idempotencyKey:'stable-fixture',body:{action:{type:'play'}}});
 assert.equal(requests[0].options.headers.Authorization,'Bearer human-fixture');assert.equal(requests[1].options.headers.Authorization,'Bearer seat-fixture');assert.equal(requests[1].options.headers['Idempotency-Key'],'stable-fixture');assert.equal(requests[1].options.redirect,'error');
 await api.disconnect();await api.request('/api/v1/games');assert.equal(requests[2].options.headers.Authorization,undefined);
});

class Element{
 id='';value='';textContent='';hidden=false;disabled=false;checked=false;readOnly=false;required=false;open=false;className='';children:any[]=[];dataset:any={};lastChild:any={textContent:''};listeners:any={};isConnected=true;
 parentNode:Element|null=null;
 append(...items:any[]){for(const item of items){item.remove?.();this.children.push(item);if(item instanceof Element)item.parentNode=this;}}
 replaceChildren(...items:any[]){for(const child of [...this.children])child.remove?.();this.children=[];this.append(...items);this.textContent='';}
 before(...items:any[]){const parent=this.parentNode;if(!parent)return;for(const item of items){if(item===this)continue;item.remove?.();parent.children.splice(parent.children.indexOf(this),0,item);if(item instanceof Element)item.parentNode=parent;}}
 addEventListener(name:string,handler:any){this.listeners[name]=handler;}
 setAttribute(){} focus(){} remove(){if(this.parentNode){const siblings=this.parentNode.children;const index=siblings.indexOf(this);if(index>=0)siblings.splice(index,1);this.parentNode=null;}} click(){}
 showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}
 querySelector(){return new Element();}
}
function uiContext(requestImpl:any,settings:any={}){
 const elements=new Map<string,Element>();const get=(id:string)=>{if(!elements.has(id)){const node=new Element();node.id=id;elements.set(id,node);}return elements.get(id)!;};
 get('create-form').append(get('create-episode'));
 const intervals:any[]=[];const transport={desktop:true,defaultApi:connection.apiUrl,getConnection:()=>new Promise(()=>{}),request:requestImpl,disconnect:async()=>{},copyText:async()=>{},...settings.transport};
 const context=vm.createContext({window:{coopTransport:transport,addEventListener(){}},document:{getElementById:get,createElement:()=>new Element(),querySelector:()=>get('pill'),hidden:false,body:new Element()},location:{origin:'coop://app',protocol:'coop:',hash:''},history:{replaceState(){}},URL,URLSearchParams,AbortController,AbortSignal,Response,DOMException,TextEncoder,crypto:webcrypto,Uint8Array,Blob,setTimeout,clearTimeout,setInterval:(handler:any,ms:number)=>{intervals.push({handler,ms});return intervals.length;},clearInterval(){},console});
 vm.runInContext(appSource,context);vm.runInContext("loadGames=async()=>{};loadList=async()=>{};selectEpisode=async()=>{};",context);if(settings.initialAuth!==false)vm.runInContext("setConnectionStatus('idle');state.token='connected';state.identity={id:'fixture',role:'operator'};state.sessionReady=true;",context);get('create-game').value='hanabi';get('create-scenario').value='base';get('create-players').value='3';return {context,get,intervals,transport};
}

test('audit UI prevents duplicate create, limits credentials to each seat, clears them on logout',async()=>{
 const pending=deferred();let count=0;const {context,get}=uiContext(async(path:string,options:any)=>{count++;assert.equal(path,'/api/v1/episodes');assert.equal(options.body.playerCount,3);return pending.promise;});
 const first=vm.runInContext('createEpisode({preventDefault(){}})',context);await vm.runInContext('createEpisode({preventDefault(){}})',context);assert.equal(count,1);assert.equal(get('create-episode').disabled,true);
 pending.resolve(Response.json({episodeId:'fixture',gameId:'hanabi',scenarioId:'base',seats:[{playerId:'p1',token:'one'},{playerId:'p2',token:'two'}]}));await first;assert.equal(get('seat-list').children.length,2);assert.equal(get('seat-configs').hidden,false);
 const config=JSON.parse(get('seat-list').children[0].children[1].children[1].textContent);assert.deepEqual(config,{baseUrl:connection.apiUrl,episodeId:'fixture',seatToken:'one',gameId:'hanabi',scenarioId:'base',playerId:'p1'});
 await vm.runInContext('disconnect()',context);assert.equal(get('seat-list').children.length,0);assert.equal(get('seat-configs').hidden,true);
});

test('audit UI rejects auditor creation and ignores a create response after session change',async()=>{
 const pending=deferred();let count=0;const {context,get}=uiContext(async()=>{count++;return pending.promise;});
 vm.runInContext("state.identity.role='auditor'",context);await vm.runInContext('createEpisode({preventDefault(){}})',context);assert.equal(count,0);
 vm.runInContext("state.identity.role='operator'",context);const creation=vm.runInContext('createEpisode({preventDefault(){}})',context);await vm.runInContext('disconnect()',context);pending.resolve(Response.json({episodeId:'fixture',seats:[{playerId:'p1',token:'stale-secret'}]}));await creation;assert.equal(get('seat-list').children.length,0);assert.equal(get('create-panel').hidden,true);
});

function enableReplaySelection(context:any){
 vm.runInContext(appSource.slice(appSource.indexOf('async function selectEpisode(id)'),appSource.indexOf('\nfunction renderHeader()')),context);
 vm.runInContext('renderHeader=renderTimeline=renderFrame=renderAnnotations=renderRules=renderLibrary=()=>{};',context);
}
const replayFixture=(id:string)=>({summary:{episodeId:id,gameId:'hanabi'},players:['p1'],frames:[{seq:0},{seq:1,action:{type:'play'}}]});
test('replay shows loading immediately, cancels superseded fetches and ignores late old results',async()=>{
 const first=deferred(),second=deferred(),signals:any[]=[];
 const {context,get}=uiContext(async(path:string,options:any)=>{signals.push(options.signal);return path.endsWith('/one')?first.promise:second.promise;});
 enableReplaySelection(context);
 const old=vm.runInContext("selectEpisode('one')",context);assert.equal(get('replay-loading').hidden,false);assert.equal(get('detail').hidden,true);
 const current=vm.runInContext("selectEpisode('two')",context);assert.equal(signals[0].aborted,true);
 second.resolve(Response.json(replayFixture('two')));await current;assert.equal(get('detail').hidden,false);assert.equal(get('replay-loading').hidden,true);
 first.resolve(Response.json(replayFixture('one')));await old;assert.equal(vm.runInContext('state.rollout.summary.episodeId',context),'two');
});
test('replay failures leave an explicit retry and logout cancels pending replay without restoring private data',async()=>{
 let response=Promise.resolve(Response.json({error:{message:'synthetic unavailable'}},{status:503}));
 const {context,get}=uiContext(async()=>response);enableReplaySelection(context);
 await vm.runInContext("selectEpisode('one')",context);assert.equal(get('replay-loading').dataset.failed,'true');assert.equal(get('retry-replay').hidden,false);assert.equal(get('detail').hidden,true);
 const pending=deferred();response=pending.promise;const loading=vm.runInContext("selectEpisode('one')",context);
 await vm.runInContext('disconnect()',context);pending.resolve(Response.json(replayFixture('one')));await loading;
 assert.equal(vm.runInContext('state.rollout',context),null);assert.equal(get('replay-loading').hidden,true);assert.equal(get('detail').hidden,true);
});

test('restoration errors are preserved without secret fields and render a red failure instead of idle/green',async()=>{
 const error={code:'TLS_ERROR',message:'证书验证失败，请检查 API 地址。',privateToken:'must-not-escape'};
 const transport=transportContext({getConnection:async()=>({...connection,connected:false,identity:null,connectionError:error}),connect:async()=>connection,request:async()=>{},cancelRequest:async()=>{},disconnect:async()=>{}});
 const restored=await transport.getConnection();assert.equal(restored.connectionError.code,'TLS_ERROR');assert.equal(restored.connectionError.privateToken,undefined);
 const {get}=uiContext(async()=>Response.json(identity),{initialAuth:false,transport:{getConnection:async()=>restored}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(get('connection-status').dataset.state,'failed');assert.equal(get('connection-status-label').textContent,'连接失败');assert.match(get('connection-reason').textContent,/证书验证失败/);assert.match(get('connection-checked').textContent,/最后检查/);
});

test('connecting shows yellow and a late old login cannot overwrite the newer verified server',async()=>{
 const first=deferred(),second=deferred();let calls=0;
 const {context,get}=uiContext(async()=>Response.json(identity),{initialAuth:false,transport:{connect:()=>++calls===1?first.promise:second.promise}});
 const oldAttempt=vm.runInContext("connect('old-synthetic-credential')",context);assert.equal(get('connection-status').dataset.state,'connecting');assert.equal(get('connect-button').disabled,true);assert.equal(get('connect-button').textContent,'正在连接…');
 get('api-address').value='https://new.example.test/api/v1';const newAttempt=vm.runInContext("connect('new-synthetic-credential')",context);second.resolve({...connection,apiUrl:'https://new.example.test/api/v1'});await newAttempt;
 assert.equal(get('connection-status').dataset.state,'connected');assert.match(get('connection-address').textContent,/new\.example\.test/);first.resolve(connection);await oldAttempt;assert.equal(get('connection-status').dataset.state,'connected');assert.match(get('connection-address').textContent,/new\.example\.test/);
 assert.equal(vm.runInContext('state.token',context),'connected');assert.doesNotMatch(JSON.stringify(get('connection-reason').textContent),/synthetic-credential/);
});

test('only identity makes green; failures turn red and the independent heartbeat restores verified connection',async()=>{
 let available=true,calls=0;const {context,get,intervals}=uiContext(async(path:string)=>{calls++;if(!available)throw Object.assign(Error('无法连接到服务器。'),{code:'CONNECTION_REFUSED'});return Response.json(path==='/api/v1/identity'?identity:{games:[]});});
 await vm.runInContext("request('/games')",context);assert.equal(get('connection-status').dataset.state,'idle');await vm.runInContext("checkConnection(true)",context);assert.equal(get('connection-status').dataset.state,'connected');
 available=false;await assert.rejects(vm.runInContext("request('/rollouts')",context));assert.equal(get('connection-status').dataset.state,'disconnected');assert.match(get('connection-reason').textContent,/无法连接/);
 get('auto-refresh').checked=false;available=true;const heartbeat=intervals.find(x=>x.ms===20000);assert.ok(heartbeat);const before=calls;heartbeat.handler();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,before+1);assert.equal(get('connection-status').dataset.state,'connected');
 get('api-address').value='https://unverified.example.test/api/v1';get('api-address').listeners.input();assert.equal(get('connection-status').dataset.state,'unverified');assert.match(get('connection-address').textContent,/当前会话 API.*example\.test/);assert.match(get('connection-reason').textContent,/新地址|修改输入地址/);
});

test('business 400/403/409 do not invalidate a connection; real 401 clears credentials and cached data',async()=>{
 let status=200,disconnects=0;const {context,get}=uiContext(async()=>Response.json(status===200?identity:{error:{code:'SYNTHETIC',message:'合成测试请求被拒绝'}},{status}),{transport:{disconnect:async()=>{disconnects++;}}});
 await vm.runInContext("checkConnection()",context);for(const value of [400,403,409]){status=value;await assert.rejects(vm.runInContext("request('/episodes',{})",context));assert.equal(get('connection-status').dataset.state,'connected');}
 get('seat-list').append(new Element());status=401;await assert.rejects(vm.runInContext("request('/rollouts')",context));assert.equal(get('connection-status').dataset.state,'expired');assert.equal(vm.runInContext('state.token',context),'');assert.equal(get('seat-list').children.length,0);assert.equal(disconnects,1);assert.equal(get('auth-panel').hidden,false);
});

test('5xx, non-JSON and proxy Basic 401 are red without falsely blaming a personal credential',async()=>{
 let mode='ok';const {context,get}=uiContext(async()=>mode==='ok'?Response.json(identity):mode==='503'?Response.json({message:'维护中'},{status:503}):mode==='html'?new Response('<html>gateway</html>'):new Response('',{status:401,headers:{'www-authenticate':'Basic realm="fixture"'}}));
 await vm.runInContext('checkConnection()',context);for(const value of ['503','html','proxy']){mode=value;await assert.rejects(vm.runInContext("request('/rollouts')",context));assert.equal(get('connection-status').dataset.state,'disconnected');assert.equal(vm.runInContext('state.token',context),'connected');}
 assert.match(get('connection-reason').textContent,/代理要求额外认证/);assert.notEqual(get('connection-status-label').textContent,'凭证失效');
});

test('a stale identity result after logout cannot turn the light green',async()=>{
 const pending=deferred();const {context,get}=uiContext(()=>pending.promise);const check=vm.runInContext('checkConnection(true)',context);await vm.runInContext('disconnect()',context);pending.resolve(Response.json(identity));await check;
 assert.equal(get('connection-status').dataset.state,'idle');assert.equal(vm.runInContext('state.token',context),'');assert.equal(get('connection-status-label').textContent,'未连接');
});

test('pending restoration is yellow, no saved login becomes gray, and malformed 403/404 API responses turn red',async()=>{
 const restored=deferred();const {get}=uiContext(async()=>Response.json(identity),{initialAuth:false,transport:{getConnection:()=>restored.promise}});assert.equal(get('connection-status').dataset.state,'checking');assert.match(get('connection-reason').textContent,/检查已保存连接/);restored.resolve({...connection,connected:false,identity:null});await new Promise(resolve=>setImmediate(resolve));assert.equal(get('connection-status').dataset.state,'idle');
 for(const status of [403,404]){let malformed=false;const fixture=uiContext(async()=>{if(malformed)throw Object.assign(Error('返回的是 HTML 而不是 API JSON。'),{code:'INVALID_API_RESPONSE',status});return Response.json(identity);});await vm.runInContext('checkConnection()',fixture.context);malformed=true;await assert.rejects(vm.runInContext("request('/rollouts')",fixture.context));assert.equal(fixture.get('connection-status').dataset.state,'disconnected');assert.match(fixture.get('connection-reason').textContent,/HTML/);}
});

test('browser login preserves real 401 versus proxy Basic 401 classification',async()=>{
 const api=transportContext(undefined,async()=>Response.json({message:'bad token'},{status:401}));await assert.rejects(api.connect({token:'synthetic'}),{code:'AUTH_REJECTED',status:401});
 const proxy=transportContext(undefined,async()=>new Response('<html>proxy</html>',{status:401,headers:{'www-authenticate':'Basic realm="fixture"'}}));await assert.rejects(proxy.connect({token:'synthetic'}),{code:'PROXY_AUTH_REQUIRED',status:401});
});

test('password bridge methods expose only public connection/account metadata and reject stale updates',async()=>{
 const pending=deferred();const inputs:any[]=[];const api=transportContext({connect:async()=>connection,request:async()=>{},cancelRequest:async()=>{},getConnection:async()=>connection,disconnect:async()=>{},login:async(value:any)=>{inputs.push(value);return {...connection,token:'session-must-not-escape',password:'must-not-escape'};},getAccount:async()=>({userId:'owner',role:'operator',passwordConfigured:true,authentication:'password-session',passwordHash:'must-not-escape'}),setPassword:(value:any)=>{inputs.push(value);return pending.promise;}});
 const loggedIn=await api.login({apiUrl:connection.apiUrl,userId:'owner',password:'synthetic-password-for-test',remember:true});assert.equal(loggedIn.token,undefined);assert.equal(loggedIn.password,undefined);assert.equal(inputs[0].remember,true);const account=await api.getAccount();assert.equal(account.passwordConfigured,true);assert.equal(account.passwordHash,undefined);
 const change=api.setPassword({password:'synthetic-new-password'});await api.disconnect();pending.resolve(connection);await assert.rejects(change,{name:'AbortError'});
});

test('browser password login rotates in-memory sessions and logout revokes only its current session',async()=>{
 const requests:any[]=[];let configured=false;const tokenOne='synthetic-session-one-000000000000',tokenTwo='synthetic-session-two-000000000000';
 const api=transportContext(undefined,async(url:string,options:any)=>{requests.push({url,options});if(url.endsWith('/auth/login'))return Response.json({token:tokenOne,identity,passwordConfigured:true});if(url.endsWith('/auth/account'))return Response.json({userId:'owner',role:'operator',passwordConfigured:configured,authentication:'password-session'});if(url.endsWith('/auth/password')){configured=true;return Response.json({token:tokenTwo,identity,passwordConfigured:true});}if(url.endsWith('/auth/logout'))return Response.json({loggedOut:true});return Response.json(identity);});
 const result=await api.login({userId:'owner',password:'synthetic-long-password'});assert.equal(result.token,undefined);assert.equal(result.connected,true);assert.equal((await api.getAccount()).passwordConfigured,false);await api.setPassword({password:'synthetic-new-password'});assert.equal((await api.getAccount()).passwordConfigured,true);await api.disconnect();await api.request('/api/v1/games');
 const login=requests.find(x=>x.url.endsWith('/auth/login')),change=requests.find(x=>x.url.endsWith('/auth/password')),logout=requests.find(x=>x.url.endsWith('/auth/logout'));assert.equal(login.options.method,'POST');assert.equal(login.options.headers.Authorization,undefined);assert.equal(change.options.headers.Authorization,`Bearer ${tokenOne}`);assert.equal(logout.options.headers.Authorization,`Bearer ${tokenTwo}`);assert.equal(requests.at(-1).options.headers.Authorization,undefined);assert.ok(requests.every(x=>!x.url.includes('password')||x.url.endsWith('/auth/password')));assert.ok(requests.every(x=>!x.url.includes('synthetic-')));
});

test('password login clears fields before awaiting and distinguishes auth failure from network failure without echoing secrets',async()=>{
 const pending=deferred();let input:any;const {context,get}=uiContext(async()=>Response.json(identity),{initialAuth:false,transport:{login:(value:any)=>{input=value;return pending.promise;}}});vm.runInContext("setConnectionStatus('idle')",context);get('login-user-id').value='owner';get('login-password').value='synthetic-login-secret';
 const submit=get('login-form').listeners.submit({preventDefault(){}});assert.equal(get('login-password').value,'');assert.equal(input.password,'synthetic-login-secret');assert.equal(get('connection-status').dataset.state,'connecting');assert.doesNotMatch(vm.runInContext('JSON.stringify(state)',context),/synthetic-login-secret/);pending.resolve(connection);await submit;assert.equal(get('connection-status').dataset.state,'connected');
 for(const [code,status,phase]of [['AUTH_REJECTED',401,'expired'],['TLS_ERROR',undefined,'failed']]as const){const failed=uiContext(async()=>Response.json(identity),{initialAuth:false,transport:{login:async()=>{throw Object.assign(Error('echo synthetic-login-secret'),{code,status});}}});vm.runInContext("setConnectionStatus('idle')",failed.context);failed.get('login-user-id').value='owner';failed.get('login-password').value='synthetic-login-secret';await failed.get('login-form').listeners.submit({preventDefault(){}});assert.equal(failed.get('connection-status').dataset.state,phase);assert.equal(failed.get('login-password').value,'');assert.doesNotMatch(failed.get('connection-reason').textContent,/synthetic-login-secret/);if(code==='TLS_ERROR')assert.match(failed.get('connection-reason').textContent,/尚未验证密码/);}
});

test('advanced personal-token login remains explicit and compatible with first password setup',async()=>{
 let credential='';const {context,get}=uiContext(async()=>Response.json(identity),{initialAuth:false,transport:{connect:async(value:any)=>{credential=value.token;return connection;},login:async()=>{throw Error('Password path must not run');}}});vm.runInContext("setConnectionStatus('idle');setLoginMode('token')",context);assert.equal(get('admin-token').disabled,false);assert.equal(get('login-password').required,false);assert.equal(get('password-login-fields').hidden,true);get('admin-token').value='synthetic-original-personal-token';await get('login-form').listeners.submit({preventDefault(){}});assert.equal(credential,'synthetic-original-personal-token');assert.equal(get('admin-token').value,'');assert.equal(get('connection-status').dataset.state,'connected');
});

test('closing settings clears all password inputs and discards late account responses',async()=>{
 const account=deferred();const {context,get}=uiContext(async()=>Response.json(identity),{transport:{getAccount:()=>account.promise}});vm.runInContext('openSettings()',context);assert.equal(get('settings-dialog').open,true);for(const id of ['current-password','new-password','confirm-password','login-password','admin-token'])get(id).value='synthetic-secret';vm.runInContext('closeSettings()',context);for(const id of ['current-password','new-password','confirm-password','login-password','admin-token'])assert.equal(get(id).value,'');assert.equal(get('settings-dialog').open,false);account.resolve({userId:'owner',role:'operator',passwordConfigured:true,authentication:'password-session'});await new Promise(resolve=>setImmediate(resolve));assert.equal(vm.runInContext('state.account',context),null);
});

test('password mismatch and missing current password fail before any request, with submitted values cleared',async()=>{
 let requests=0;const {context,get}=uiContext(async()=>Response.json(identity),{transport:{setPassword:async()=>{requests++;return connection;}}});vm.runInContext("state.account={userId:'owner',passwordConfigured:false};",context);get('settings-api-address').value=connection.apiUrl;get('new-password').value='synthetic-password-one';get('confirm-password').value='synthetic-password-two';await vm.runInContext('savePassword({preventDefault(){}})',context);assert.equal(requests,0);assert.match(get('settings-message').textContent,/不一致/);assert.equal(get('new-password').value,'');assert.equal(get('confirm-password').value,'');
 vm.runInContext('state.account.passwordConfigured=true',context);get('new-password').value='synthetic-password-one';get('confirm-password').value='synthetic-password-one';await vm.runInContext('savePassword({preventDefault(){}})',context);assert.equal(requests,0);assert.match(get('settings-message').textContent,/当前密码/);
});

test('password setup uses the authenticated bridge, pauses heartbeat, and never retains raw password values',async()=>{
 const pending=deferred();let input:any,reads=0;const {context,get,intervals}=uiContext(async()=>{reads++;return Response.json(identity);},{transport:{setPassword:(value:any)=>{input=value;return pending.promise;},getAccount:async()=>({userId:'owner',role:'operator',passwordConfigured:true,authentication:'password-session'})}});vm.runInContext("state.account={userId:'owner',passwordConfigured:false};",context);get('settings-api-address').value=connection.apiUrl;get('settings-remember').checked=true;get('new-password').value='synthetic-password-one';get('confirm-password').value='synthetic-password-one';const submit=vm.runInContext('savePassword({preventDefault(){}})',context);assert.equal(get('new-password').value,'');assert.equal(get('save-password').disabled,true);assert.equal(input.remember,true);assert.equal(input.currentPassword,undefined);intervals.find(x=>x.ms===20000).handler();await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,0);pending.resolve({...connection,remembered:true});await submit;assert.equal(get('save-password').disabled,false);assert.equal(get('settings-account-status').textContent,'已设置密码');assert.match(get('settings-message').textContent,/密码已保存/);assert.doesNotMatch(vm.runInContext('JSON.stringify(state)',context),/synthetic-password-one/);assert.equal(get('confirm-password').value,'');
});

test('new password policy counts Unicode characters and rejects malformed strings before submission',async()=>{
 let changes=0;const api=transportContext({connect:async()=>connection,request:async()=>{},cancelRequest:async()=>{},getConnection:async()=>connection,login:async()=>connection,setPassword:async()=>{changes++;return connection;},disconnect:async()=>{}});await api.login({userId:'owner',password:'short'});await api.setPassword({password:'😀'.repeat(12)});await api.setPassword({password:'😀'.repeat(128)});assert.equal(changes,2);for(const password of ['😀'.repeat(11),'a'.repeat(129),' '.repeat(12),'a'.repeat(12)+'\ud800'])await assert.rejects(api.setPassword({password}),{status:400});assert.equal(changes,2);
});

test('password rotation ignores in-flight old 401 and logout prevents late setup UI updates',async()=>{
 const oldRead=deferred(),change=deferred();let first=true;const {context,get}=uiContext(async()=>{if(first){first=false;return oldRead.promise;}return Response.json(identity);},{transport:{setPassword:()=>change.promise,getAccount:async()=>({userId:'owner',role:'operator',passwordConfigured:true,authentication:'password-session'})}});vm.runInContext("state.account={userId:'owner',passwordConfigured:false};",context);get('settings-api-address').value=connection.apiUrl;
 const request=vm.runInContext("request('/rollouts')",context);get('new-password').value='synthetic-valid-password';get('confirm-password').value='synthetic-valid-password';const save=vm.runInContext('savePassword({preventDefault(){}})',context);oldRead.resolve(Response.json({error:{code:'UNAUTHORIZED'}},{status:401}));await assert.rejects(request,{name:'AbortError'});assert.equal(vm.runInContext('state.token',context),'connected');await vm.runInContext('disconnect()',context);change.resolve(connection);await save;assert.equal(vm.runInContext('state.token',context),'');assert.equal(get('connection-status').dataset.state,'idle');assert.equal(get('password-form').hidden,true);assert.equal(get('new-password').value,'');
});

