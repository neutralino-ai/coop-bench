// The static startup screen remains visible even if a later bundle fails.
if(typeof document!=='undefined'){
 const screen=document.getElementById('startup-screen'),label=document.getElementById('startup-label');
 const fail=()=>{if(screen&&!screen.hidden){label.textContent='界面启动未完成，请重试；若仍失败，请重新启动客户端。';screen.dataset.failed='true';}};
 const timer=setTimeout(fail,10000);
 window.addEventListener('error',fail);
 document.getElementById('startup-retry')?.addEventListener('click',()=>location.reload());
 window.CoopStartup={ready(){clearTimeout(timer);if(screen)screen.hidden=true;window.removeEventListener('error',fail);}};
}
/* The desktop bridge owns human credentials. Renderers receive public connection
 * metadata and response bytes only; the browser fallback stays same-origin. */
(()=>{
 'use strict';
 const bridge=window.coopDesktop;
 const desktop=Boolean(bridge?.request&&bridge?.connect);
 const defaultApi=desktop?'https://coop.neutrinophysics.cn:34936/api/v1':`${location.origin}/api/v1`;
 let info={mode:desktop?'remote':'browser',apiUrl:defaultApi,connected:false,identity:null,remembered:false};
 let browserToken='',browserSession=false,generation=0;
 const pending=new Map();
 const abortError=()=>new DOMException('连接已更换或请求已取消。','AbortError');
 function unwrapBridge(value){if(value&&typeof value==='object'&&value.__coopClientError){const detail=value.__coopClientError,error=Error(String(detail.message??'桌面连接请求失败。'));if(typeof detail.code==='string')error.code=detail.code;if(Number.isInteger(detail.status))error.status=detail.status;throw error;}return value;}
 const publicInfo=()=>({...info,identity:info.identity?{...info.identity}:null});
 function invalidate(){generation++;for(const cancel of pending.values())cancel();pending.clear();}
 function apiPath(value){
  if(typeof value!=='string'||!value.startsWith('/api/v1/')||value.includes('\\')||value.includes('#'))throw Error('只允许当前服务器的 API 路径。');
  const parsed=new URL(value,'https://api.invalid');
  if(parsed.origin!=='https://api.invalid'||!parsed.pathname.startsWith('/api/v1/'))throw Error('无效 API 路径。');
  return parsed.pathname+parsed.search;
 }
 async function requestOnce(path,{method='GET',body,signal,seatToken,idempotencyKey}={}){
  path=apiPath(path);method=method.toUpperCase();
  if(!['GET','POST'].includes(method))throw Error('不支持的请求方法。');
  if(body!==undefined&&(body===null||typeof body!=='object'||Array.isArray(body)))throw Error('请求内容必须是 JSON 对象。');
  if(signal?.aborted)throw abortError();
  const version=generation,id=crypto.randomUUID();
  if(desktop){
   if(seatToken!==undefined||idempotencyKey!==undefined)throw Error('桌面审计台仅使用人工访问权限。请让 Agent 使用独立座位凭证连接 API。');
   let cancel;
   const cancelled=new Promise((_,reject)=>{cancel=()=>{Promise.resolve(bridge.cancelRequest(id)).catch(()=>{});reject(abortError());};});
   pending.set(id,cancel);signal?.addEventListener('abort',cancel,{once:true});
   try{
    const value=await Promise.race([bridge.request({id,path,method,...(body!==undefined?{body}:{})}),cancelled]);
    if(version!==generation||signal?.aborted)throw abortError();
    const response=unwrapBridge(value);
    return new Response([204,205,304].includes(response.status)?null:new Uint8Array(response.bytes),{status:response.status,headers:response.headers});
   }finally{pending.delete(id);signal?.removeEventListener('abort',cancel);}
  }
  const controller=new AbortController(),cancel=()=>controller.abort();pending.set(id,cancel);signal?.addEventListener('abort',cancel,{once:true});
  try{
   const token=seatToken===undefined?browserToken:seatToken;
   const response=await fetch(`${location.origin}${path}`,{method,signal:controller.signal,credentials:'omit',redirect:'error',headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
   if(version!==generation)throw abortError();return response;
  }finally{pending.delete(id);signal?.removeEventListener('abort',cancel);}
 }
 async function request(path,options={}){
  const version=generation;
  for(let retry=0;;retry++){
   if(version!==generation||options.signal?.aborted)throw abortError();
   const response=await requestOnce(path,options);
   if(response.status!==429||(options.method??'GET').toUpperCase()!=='GET'||retry>=2)return response;
   const retryAfter=response.headers.get('retry-after');
   const advertised=retryAfter&&/^\d+$/.test(retryAfter)?Number(retryAfter)*1000:retryAfter?Date.parse(retryAfter)-Date.now():NaN;
   const ms=Number.isNaN(advertised)?3200*(retry+1):Math.max(1000,advertised);
   // Never retry earlier than the server asks. A long advertised pause exceeds
   // this interactive budget, so return the 429 for a later explicit retry.
   if(!Number.isFinite(ms)||ms>15000)return response;
   await response.body?.cancel();
   await new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();let timer;
    const cleanup=()=>{clearTimeout(timer);pending.delete(id);options.signal?.removeEventListener('abort',cancel);};
    const cancel=()=>{cleanup();reject(abortError());};
    timer=setTimeout(()=>{cleanup();resolve();},ms);pending.set(id,cancel);options.signal?.addEventListener('abort',cancel,{once:true});
    if(version!==generation||options.signal?.aborted)cancel();
   });
  }
 }
 function accept(value){info={mode:desktop?'remote':'browser',apiUrl:value.apiUrl||defaultApi,connected:Boolean(value.connected),identity:value.identity??null,remembered:Boolean(value.remembered),...(value.connectionError?{connectionError:typeof value.connectionError==='string'?value.connectionError:{message:String(value.connectionError.message??'保存的连接恢复失败。'),...(typeof value.connectionError.code==='string'?{code:value.connectionError.code}:{}),...(Number.isInteger(value.connectionError.status)?{status:value.connectionError.status}:{})}}:{})};return publicInfo();}
 async function getConnection(){const version=generation;if(!desktop)return publicInfo();const received=await bridge.getConnection();if(version!==generation)throw abortError();const value=unwrapBridge(received);return accept(value);}
 async function connect({apiUrl=defaultApi,token,remember=false}){
  invalidate();const version=generation;browserToken='';browserSession=false;info={...info,connected:false,identity:null,remembered:false,connectionError:undefined};
  if(!String(token??'').trim())throw Error('请输入个人访问凭证。');
  if(desktop){const received=await bridge.connect({apiUrl,token:token.trim(),remember:Boolean(remember)});if(version!==generation)throw abortError();return accept(unwrapBridge(received));}
  if(apiUrl.replace(/\/$/,'')!==defaultApi)throw Error('浏览器模式使用当前页面的同源 API；跨服务器连接请使用桌面客户端。');
  browserToken=token.trim();
  try{const response=await request('/api/v1/identity',{signal:AbortSignal.timeout(20000)});if(response.status===401){const proxy=/\bBasic\b|\bDigest\b/i.test(response.headers.get('www-authenticate')??'');throw Object.assign(Error(proxy?'API 代理要求额外认证，尚未验证个人凭证。':'个人凭证无效或已失效，请重新输入。'),{status:401,code:proxy?'PROXY_AUTH_REQUIRED':'AUTH_REJECTED'});}let identity;try{identity=await response.json();}catch{throw Object.assign(Error('服务器没有返回有效的 JSON API 身份响应，请检查 API 地址。'),{status:response.status,code:'INVALID_API_RESPONSE'});}if(version!==generation)throw abortError();if(!response.ok)throw Object.assign(Error(identity.error?.message??identity.message??`连接失败 (${response.status})`),{status:response.status,code:response.status===403?'PERMISSION_DENIED':response.status>=500?'API_UNAVAILABLE':'AUTH_REJECTED'});return accept({apiUrl:defaultApi,connected:true,identity,remembered:false});}
  catch(error){if(version===generation)browserToken='';throw error;}
 }
 function authError(status,code){
  const labels={AUTH_REJECTED:'账号或密码不正确，或会话已失效。',PERMISSION_DENIED:'当前账号无权执行此操作。',AUTH_CONFLICT:'密码已被其他会话修改，请重新登录后再试。',INVALID_REQUEST:'输入不符合要求，请检查账号或密码格式。',RATE_LIMITED:'操作过于频繁，请稍后重试。',API_UNAVAILABLE:'服务器暂不可用，请稍后检查连接。',AUTH_UNAVAILABLE:'此服务器尚未启用账号密码功能，可先使用个人凭证登录。',INVALID_API_RESPONSE:'未收到有效的账号 API 响应，请检查服务器地址。'};
  const key=code==='INVALID_API_RESPONSE'?'INVALID_API_RESPONSE':code==='AUTH_CONFLICT'?'AUTH_CONFLICT':status===401?'AUTH_REJECTED':status===403?'PERMISSION_DENIED':status===404?'AUTH_UNAVAILABLE':status===429?'RATE_LIMITED':status>=500?'API_UNAVAILABLE':status===400?'INVALID_REQUEST':'INVALID_API_RESPONSE';
  return Object.assign(Error(labels[key]),{code:key,status});
 }
 function validPassword(value,min=1){return typeof value==='string'&&value.isWellFormed()&&value.trim().length>0&&Array.from(value).length>=min&&Array.from(value).length<=128&&new TextEncoder().encode(value).byteLength<=512;}
 async function authJson(path,body,tokenOverride){
  const response=await request('/api/v1'+path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{body}),...(tokenOverride===undefined?{}:{seatToken:tokenOverride}),signal:AbortSignal.timeout(20000)});
  if(response.status===401&&/\bBasic\b|\bDigest\b/i.test(response.headers.get('www-authenticate')??''))throw Object.assign(Error('API 代理要求额外认证，尚未验证账号密码。'),{code:'PROXY_AUTH_REQUIRED',status:401});
  let value;try{value=await response.json();}catch{throw authError(response.status,'INVALID_API_RESPONSE');}
  if(!response.ok)throw authError(response.status,value?.error?.code??value?.code);
  if(!value||typeof value!=='object'||Array.isArray(value))throw authError(response.status,'INVALID_API_RESPONSE');return value;
 }
 async function login({apiUrl=defaultApi,userId,password,remember=false}){
  invalidate();const version=generation;browserToken='';browserSession=false;info={...info,connected:false,identity:null,remembered:false,connectionError:undefined};
  if(typeof userId!=='string'||!userId.trim()||!validPassword(password))throw authError(400);
  if(desktop){if(!bridge.login)throw authError(404);const received=await bridge.login({apiUrl,userId:userId.trim(),password,remember:Boolean(remember)});if(version!==generation)throw abortError();return accept(unwrapBridge(received));}
  if(apiUrl.replace(/\/$/,'')!==defaultApi)throw Error('浏览器模式使用当前页面的同源 API；跨服务器连接请使用桌面客户端。');
  try{const result=await authJson('/auth/login',{userId:userId.trim(),password},'');if(version!==generation)throw abortError();if(typeof result.token!=='string'||result.token.length<24)throw authError(200);browserToken=result.token;browserSession=true;const identity=await authJson('/identity');if(version!==generation)throw abortError();return accept({apiUrl:defaultApi,connected:true,identity,remembered:false});}
  catch(error){if(version===generation){browserToken='';browserSession=false;}if(error?.name==='TypeError')throw Object.assign(Error('无法连接服务器，尚未验证账号密码。'),{code:'NETWORK_UNREACHABLE'});throw error;}
 }
 async function getAccount(){const version=generation;const received=desktop?(bridge.getAccount?unwrapBridge(await bridge.getAccount()):(()=>{throw authError(404);})()):await authJson('/auth/account');if(version!==generation)throw abortError();return {userId:received.userId,role:received.role,passwordConfigured:Boolean(received.passwordConfigured),authentication:received.authentication,...(typeof received.sessionExpiresAt==='string'?{sessionExpiresAt:received.sessionExpiresAt}:{})};}
 async function setPassword({password,currentPassword,remember=false}){
  let version=generation;if(!validPassword(password,12)||currentPassword!==undefined&&!validPassword(currentPassword))throw authError(400);
  if(desktop){if(!bridge.setPassword)throw authError(404);const received=await bridge.setPassword({password,...(currentPassword===undefined?{}:{currentPassword}),remember:Boolean(remember)});if(version!==generation)throw abortError();const next=unwrapBridge(received);invalidate();return accept(next);}
  const result=await authJson('/auth/password',{password,...(currentPassword===undefined?{}:{currentPassword})});if(version!==generation)throw abortError();if(typeof result.token!=='string'||result.token.length<24)throw authError(200);invalidate();version=generation;browserToken=result.token;browserSession=true;const identity=await authJson('/identity');if(version!==generation)throw abortError();return accept({apiUrl:defaultApi,connected:true,identity,remembered:false});
 }
 async function disconnect(){const oldToken=browserToken,revoke=browserSession;invalidate();const version=generation;browserToken='';browserSession=false;info={...info,connected:false,identity:null,remembered:false,connectionError:undefined};if(desktop){const result=unwrapBridge(await bridge.disconnect());if(result?.logoutWarning)throw Object.assign(Error('本机已退出，但尚未确认服务器撤销会话；请稍后重新连接确认。'),{code:'LOGOUT_UNCONFIRMED'});}else if(revoke){try{await authJson('/auth/logout',{},oldToken);}catch(error){if(version===generation&&error.status!==401)throw error;}}}
 const updates=bridge?.updateInfo?Object.fromEntries(['updateInfo','checkUpdate','downloadUpdate','installUpdate'].map(name=>[name,()=>Promise.resolve(bridge[name]()).then(unwrapBridge)])):{};
 window.coopTransport=Object.freeze({...updates,...(bridge?.hostSeat?{hostSeat:(name,input)=>Promise.resolve(bridge.hostSeat(name,input)).then(unwrapBridge)}:{}),...(bridge?.openPlayer?{openPlayer:input=>Promise.resolve(bridge.openPlayer(input)).then(unwrapBridge)}:{}),desktop,defaultApi,getConnection,connect,login,getAccount,setPassword,disconnect,request,copyText:text=>bridge?.copyText?Promise.resolve(bridge.copyText(String(text))).then(unwrapBridge):navigator.clipboard.writeText(String(text))});
})();

