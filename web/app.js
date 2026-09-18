/* Audit rendering uses recorded per-seat projections only. Never consult a final
 * state to fill hidden cards in an earlier frame. All model text is textContent. */
const $=id=>document.getElementById(id);
const transport=window.coopTransport;
let apiUrl=transport.defaultApi;
const state={token:'',identity:null,session:0,connectionCheck:false,sessionReady:false,authMode:'password',account:null,accountRequest:0,passwordBusy:false,remembered:false,connection:{phase:'idle',reason:'输入账号密码登录；首次设置可使用高级个人凭证登录。',attemptUrl:apiUrl,verifiedUrl:'',lastCheckedAt:null},games:[],creating:false,items:[],total:0,rollout:null,index:0,playing:null,loading:false,listRequest:0,detailRequest:0,artifacts:[],artifactRequest:0,artifactLoading:false,artifactError:'',downloadControllers:new Set(),downloadUrls:new Set(),modelMessages:[],modelMessageRequest:0,modelMessageLoading:false,modelMessageError:'',modelMessagePlayer:'',modelMessagePage:0,modelMessageCursors:[-1],modelMessageNextAfter:-1,modelMessageHasMore:false,modelMessageCompletion:null};
const labels={phase:'游戏阶段',playerId:'本玩家',currentPlayerId:'当前玩家',activePlayers:'可行动玩家',activePlayerIds:'可行动玩家',hand:'本人手牌',hands:'各玩家手牌',handCounts:'剩余手牌',round:'轮次',turn:'行动轮次',board:'棋盘',piles:'牌堆',discard:'弃牌',discards:'弃牌',deckCount:'牌库剩余',lives:'生命',hints:'提示',hintTokens:'提示标记',score:'分数',tasks:'共同任务',mission:'任务',trick:'本墩',tricks:'已完成牌墩',leader:'领出玩家',captain:'船长',tokens:'标记',dice:'骰子',altitude:'高度',axis:'轴线',speed:'速度',brakes:'刹车',flaps:'襟翼',landingGear:'起落架',traffic:'空中交通',level:'关卡',roles:'玩家职责',timeRemainingMs:'剩余时间（毫秒）',timer:'计时器',remaining:'剩余数量',result:'结果',public:'公共信息',private:'本人信息',colors:'颜色',value:'数值',color:'颜色',position:'位置',playerIds:'所有玩家',communication:'沟通标记',status:'状态',stacks:'牌堆',fireworks:'烟花',bombs:'失误标记',wires:'电线',tools:'工具',equipment:'装备',tiles:'地图板块',heroes:'英雄位置',shopping:'购物目标',exits:'出口',rules:'规则',legalActions:'可用动作',ownPlacements:'本人已出的牌',faceUpRemaining:'可用明置次数'};
const phaseNames={discussion:'讨论阶段',playing:'出牌阶段',resolution:'判定阶段',finished:'对局结束',completed:'对局结束',active:'进行中',truncated:'已截断',setup:'准备阶段'};
function node(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=String(text);return n;}
function setText(id,text){$(id).textContent=text??'';}
function options(id,items,selected){$(id).replaceChildren(...items.map(([value,label])=>{const o=node('option','',label);o.value=value;return o;}));if(selected&&items.some(x=>x[0]===selected))$(id).value=selected;}
function message(text,error=false){$('message').hidden=!text;$('message').className=`notice global-notice${error?' error':''}`;setText('message',text);}
function date(value,full=false){if(!value)return '时间未记录';const d=new Date(value);if(Number.isNaN(d.getTime()))return String(value);return d.toLocaleString('zh-CN',full?{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}:{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
function isDone(summary){return !!summary&&(summary.status==='completed'||summary.status==='truncated'||!!summary.outcome);}
function outcome(summary){if(summary.outcome?.kind==='score-only')return {label:`得分 ${summary.outcome.score}`,className:'neutral'};if(summary.outcome?.success===true||summary.outcome?.kind==='win')return {label:'团队获胜',className:''};if(summary.outcome?.success===false||summary.outcome?.kind==='loss')return {label:'团队失败',className:'loss'};return {label:phaseNames[summary.status]??summary.status??'未记录',className:summary.status==='active'?'active':'neutral'};}
function actionName(frame){const t=frame?.action?.type;return ({speak:'公开讨论',message:'公开讨论',chat:'公开讨论',signal:'行动提醒',look_hand:'查看手牌',place:'放置卡牌',play:'出牌',discard:'弃牌',hint:'提示',communicate:'任务沟通',vote:'投票',choose:'选择',move:'移动',cut:'剪线',tick:'时钟推进'})[t]??t??({created:'创建对局',initial:'初始状态',system:'系统事件',rejected:'拒绝操作',observation:'拉取观察',truncated:'截断对局'})[frame?.kind]??frame?.kind??'事件';}
function isRejected(frame){return !!frame?.error||/reject/.test(frame?.kind??'');}
function connectionErrorText(error){let text=typeof error==='string'?error:error?.message??'无法完成请求。';if(error?.name==='TimeoutError')text='连接超时，请检查 API 地址与网络。';else if(/^(Failed to fetch|fetch failed|NetworkError)/i.test(text))text='无法连接 API，请检查地址和网络。';return String(text).replace(/Bearer\s+[^\s]+/gi,'Bearer [已隐藏]').slice(0,600);}
function setConnectionStatus(phase,reason='',extra={}){state.connection={...state.connection,...extra,phase,reason};renderConnectionStatus();}
function sameApi(left,right){return String(left??'').trim().replace(/\/$/,'')===String(right??'').trim().replace(/\/$/,'');}
function displayApi(value){try{const parsed=new URL(value);parsed.username='';parsed.password='';parsed.search='';parsed.hash='';return parsed.href.replace(/\/$/,'');}catch{return 'API 地址格式尚未验证';}}
function renderConnectionStatus(){
 const connection=state.connection,draft=$('api-address').value.trim(),changed=draft&&!sameApi(draft,apiUrl),phase=changed?'unverified':connection.phase;
 const labels={idle:'未连接',connecting:'连接中',checking:'检查中',connected:'已连接',failed:'连接失败',disconnected:'连接已断开',expired:'凭证失效',unverified:'新地址未验证'};
 $('connection-status').className=`connection-status ${phase}`;$('connection-status').dataset.state=phase;$('connection-light').className=`connection-light ${phase}`;setText('connection-status-label',labels[phase]??'未连接');
 setText('connection-address',changed?(state.token?`当前会话 API：${displayApi(apiUrl)}；新地址尚未连接`:`新 API 尚未验证：${displayApi(draft)}`):connection.verifiedUrl&&sameApi(connection.attemptUrl,connection.verifiedUrl)?`已验证 API：${displayApi(connection.verifiedUrl)}`:`待验证 API：${displayApi(connection.attemptUrl||apiUrl)}`);
 setText('connection-reason',changed?(state.token?'已修改输入地址。点击“连接审计台”并重新验证凭证，当前请求仍使用上方原地址。':'输入地址尚未验证。请填写个人访问凭证，然后点击“连接审计台”。'):connection.reason||'');
 setText('connection-checked',connection.lastCheckedAt?`最后检查：${date(connection.lastCheckedAt,true)}`:'尚未检查');
 const busy=['connecting','checking'].includes(connection.phase);$('connect-button').disabled=busy;setText('connect-button',connection.phase==='connecting'?'正在连接…':'登录审计台');$('check-connection').disabled=busy||state.connectionCheck;setText('check-connection',state.connectionCheck?'正在检查…':'检查连接');
 let host;try{host=new URL(apiUrl).host;}catch{host='未验证地址';}setText('connection',`${host} · ${labels[phase]??'未连接'}`);setText('settings-connection-label',labels[phase]??'未连接');setText('settings-connection-reason',$('connection-reason').textContent);$('settings-connection').className=`settings-connection ${phase}`;$('settings-check').disabled=busy||state.connectionCheck||state.passwordBusy;
}
function markIdentityVerified(identity){if(!identity||typeof identity.id!=='string'||!identity.id||!['coordinator','operator','auditor'].includes(identity.role))throw Error('身份验证响应格式不正确，未确认登录成功。');state.identity=identity;setConnectionStatus('connected',`身份已验证：${identity.id} · ${identity.role}。每 20 秒检查一次连接。`,{attemptUrl:apiUrl,verifiedUrl:apiUrl,lastCheckedAt:new Date().toISOString()});}
async function markConnectionFailure(error,{status=0,session=state.session,identityCheck=false}={}){
 if(session!==state.session||error?.code==='CANCELLED'||error?.name==='AbortError'&&!error?.connectionTimeout)return;
 const now=new Date().toISOString(),reason=connectionErrorText(error);
 if(status===401&&error?.code!=='PROXY_AUTH_REQUIRED'){resetSession();setConnectionStatus('expired','凭证已失效或不正确，请重新输入组织者提供的个人访问凭证。',{lastCheckedAt:now});try{await transport.disconnect();}catch{}return;}
 if(status>=400&&status<500&&!identityCheck&&(!error?.code||error.code==='PERMISSION_DENIED'))return;
 setConnectionStatus(state.connection.verifiedUrl&&sameApi(apiUrl,state.connection.verifiedUrl)?'disconnected':'failed',status>=500?`后端暂时不可用（HTTP ${status}）。${reason}`:reason,{lastCheckedAt:now});
}
async function request(path,body){
 const session=state.session,signal=AbortSignal.timeout(20000);let response,data;
 try{response=await transport.request('/api/v1'+path,{signal,method:body?'POST':'GET',...(body?{body}:{})});}
 catch(error){if(signal.aborted&&session===state.session)error=Object.assign(Error('连接超时，尚未确认服务器响应；请检查 API 地址与网络。'),{connectionTimeout:true});await markConnectionFailure(error,{session,status:Number(error?.status??0),identityCheck:path==='/identity'});throw error;}
 if(session!==state.session)throw new DOMException('连接已更换，旧请求已丢弃。','AbortError');
 if(response.status===401){const proxy=/\bBasic\b|\bDigest\b/i.test(response.headers.get('www-authenticate')??'');const error=Object.assign(Error(proxy?'API 前方的代理要求额外认证，尚未验证个人凭证。请联系组织者检查代理配置。':'凭证已失效或不正确，请重新连接。'),{status:401,code:proxy?'PROXY_AUTH_REQUIRED':'AUTH_REJECTED'});await markConnectionFailure(error,{status:401,session});throw error;}
 try{data=await response.json();}catch{const error=Error(`服务返回 HTTP ${response.status}，但不是有效 JSON API 响应；请核对 API 地址。`);await markConnectionFailure(error,{session});throw error;}
 if(session!==state.session)throw new DOMException('连接已更换，旧请求已丢弃。','AbortError');
 if(!response.ok){const error=Object.assign(Error(`${data.error?.code??data.code??response.status}：${data.error?.message??data.message??'请求被服务器拒绝'}`),{status:response.status});await markConnectionFailure(error,{status:response.status,session,identityCheck:path==='/identity'});throw error;}
 if(path==='/identity'){try{markIdentityVerified(data);}catch(error){await markConnectionFailure(error,{session});throw error;}}
 return data;
}
async function checkConnection(manual=false){
 if(state.connectionCheck||state.passwordBusy)return false;
 if(!state.token){if(manual){$('auth-panel').hidden=false;$(state.authMode==='password'?'login-password':'admin-token').focus();message('请先登录审计台，再检查已验证的连接。');}return false;}
 if(manual&&!sameApi($('api-address').value,apiUrl)){renderConnectionStatus();message('新 API 地址尚未连接，请输入凭证并点击“连接审计台”。');return false;}
 const session=state.session;state.connectionCheck=true;if(manual)setConnectionStatus('checking','正在向当前 API 验证身份…');else renderConnectionStatus();
 try{const identity=await request('/identity');if(session!==state.session)return false;const recovering=!state.sessionReady;state.identity=identity;renderAuthenticatedControls(undefined,recovering);if(recovering)await Promise.all([loadGames(),loadList()]);if(manual)message('连接成功，个人身份已由服务器验证。');return true;}
 catch(error){if(manual&&session===state.session)message(connectionErrorText(error),true);return false;}
 finally{if(session===state.session){state.connectionCheck=false;renderConnectionStatus();}}
}

function guarded(id,fn){$(id).addEventListener('click',async()=>{const button=$(id),session=state.session;button.disabled=true;try{await fn();}catch(error){if(session===state.session&&error.name!=='AbortError')message(error.message,true);}finally{button.disabled=false;}});}
function renderLibrary(){setText('total',state.total);const selected=state.rollout?.summary.episodeId;$('episode-list').replaceChildren();if(!state.items.length){$('episode-list').append(node('div','library-empty','没有符合筛选条件的对局。Agent 创建并行动后，记录会自动出现在这里。'));return;}
 for(const s of state.items){const item=node('button',`episode-card${s.episodeId===selected?' selected':''}`);item.dataset.episode=s.episodeId;item.setAttribute('aria-label',`${s.gameName??s.gameId} ${s.episodeId}`);const top=node('div','card-top');top.append(node('span','mini-label',`${s.playerCount} PLAYERS`));const result=outcome(s);top.append(node('span',`badge ${result.className}`,result.label));const bottom=node('div','card-bottom');bottom.append(node('span','',date(s.createdAt)),node('span','',`${s.actionCount??0} 个动作`));item.append(top,node('div','game-name',s.gameName??s.gameId),node('div','scenario-name',s.scenarioId),bottom);item.onclick=()=>selectEpisode(s.episodeId).catch(e=>message(e.message,true));$('episode-list').append(item);}
 $('load-more').hidden=state.items.length>=state.total;
}
async function loadList(append=false){if(!state.token)return;const serial=++state.listRequest;const query=new URLSearchParams({limit:'50',offset:String(append?state.items.length:0)});if($('filter-game').value)query.set('gameId',$('filter-game').value);if($('filter-status').value)query.set('status',$('filter-status').value);const data=await request(`/rollouts?${query}`);if(serial!==state.listRequest)return;state.items=append?[...state.items,...data.items]:data.items;state.total=data.total;renderLibrary();}
function resetSession(){window.CoopFocus?.clear();clearSensitiveFields();state.account=null;state.accountRequest++;state.passwordBusy=false;state.remembered=false;stopPlayback();clearArtifacts();clearModelMessages();state.session++;state.listRequest++;state.detailRequest++;state.token='';state.identity=null;state.connectionCheck=false;state.sessionReady=false;state.creating=false;$('create-episode').disabled=false;setText('create-episode','创建对局');state.games=[];$('create-panel').hidden=true;$('seat-list').replaceChildren();$('seat-configs').hidden=true;for(const id of ['create-game','create-scenario','create-players','create-rules','create-scope'])$(id).replaceChildren();state.rollout=null;state.items=[];state.total=0;state.index=0;$('detail').hidden=true;$('welcome').hidden=false;$('auth-panel').hidden=false;$('admin-token').value='';$('annotation-text').value='';for(const id of ['episode-title','episode-subtitle','episode-stats','board','raw-observation','discussion','discussion-context','discussion-count','event-strip','event-meta','event-content','event-json','annotations','rules','verification-result'])$(id).replaceChildren();setText('auth-toggle','登录');setText('identity-permissions','');$('identity-permissions').hidden=true;setText('retention-policy','连接后读取服务器的保存策略。');$('disconnect').hidden=true;renderLibrary();renderSettingsAccount();}
async function disconnect(){resetSession();setConnectionStatus('idle','已退出，输入凭证后可重新连接。',{verifiedUrl:'',lastCheckedAt:null});await transport.disconnect();updateConnectionLabel();}
function updateConnectionLabel(){document.querySelector('.local-pill').textContent=transport.desktop?'云端 API':location.protocol==='https:'?'私有共享':'本机服务';renderConnectionStatus();}

async function loadGames(){const session=state.session;const data=await request('/games');if(session!==state.session)return;state.games=data.games;options('filter-game',[['','所有游戏'],...state.games.map(game=>[game.id,game.name])]);options('create-game',state.games.map(game=>[game.id,game.name]));chooseGame();}
function renderAuthenticatedControls(remembered,hideLogin=false){
 renderIdentity();$('login-user-id').value=state.identity.id;$('disconnect').hidden=false;setText('auth-toggle',`${state.identity.id} · ${state.identity.role}`);$('verify-replay').hidden=state.identity.role==='auditor';$('create-panel').hidden=state.identity.role==='auditor';const reflection=$('annotation-kind').querySelector('[value="reflection"]');reflection.disabled=state.identity.role==='auditor';if(reflection.disabled)$('annotation-kind').value='review';if(remembered!==undefined){state.remembered=remembered;$('remember-credential').checked=remembered;$('settings-remember').checked=remembered;}if(hideLogin){clearSensitiveFields();$('auth-panel').hidden=true;}state.sessionReady=true;updateConnectionLabel();renderSettingsAccount();
}
async function activateConnection(info,session){
 if(session!==state.session||!info.connected)return;apiUrl=info.apiUrl;state.token='connected';$('api-address').value=apiUrl;setConnectionStatus('connecting','正在验证服务器身份响应…',{attemptUrl:apiUrl});
 state.identity=await request('/identity');if(session!==state.session)return;renderAuthenticatedControls(info.remembered,true);message('连接成功，身份已验证。');
 await Promise.all([loadGames(),loadList()]);if(session!==state.session)return;const episode=new URLSearchParams(location.hash.slice(1)).get('episode');const available=state.items.find(s=>(!episode||s.episodeId===episode)&&(state.identity.role!=='auditor'||isDone(s)));if(available)await selectEpisode(available.episodeId);
}
async function beginLogin(perform,description,safeErrors=false){
 const address=$('api-address').value.trim(),remember=$('remember-credential').checked;resetSession();const session=state.session;apiUrl=address;setConnectionStatus('connecting',description,{attemptUrl:address,verifiedUrl:'',lastCheckedAt:null});
 try{const info=await perform({apiUrl:address,remember});if(session!==state.session)return;if(!info.connected)throw info.connectionError??Error('服务器未确认登录成功。');await activateConnection(info,session);}
 catch(error){if(session===state.session){const text=safeErrors?accountErrorText(error):connectionErrorText(error),status=Number(error?.status??0);if(!state.token){setConnectionStatus(status===401&&error?.code!=='PROXY_AUTH_REQUIRED'?'expired':'failed',text,{lastCheckedAt:new Date().toISOString()});try{await transport.disconnect();}catch{}}else if(state.connection.phase==='connecting')await markConnectionFailure(Object.assign(Error(text),{code:error?.code}),{session,status,identityCheck:true});message(text,true);}throw error;}
}
async function connect(token){return beginLogin(options=>transport.connect({...options,token}),'正在连接 API 并验证个人凭证…');}
async function loginWithPassword(userId,password){return beginLogin(options=>transport.login({...options,userId,password}),'正在连接 API 并验证账号密码…',true);}
function clearSensitiveFields(){for(const id of ['login-password','admin-token','current-password','new-password','confirm-password'])$(id).value='';}
function setLoginMode(mode){state.authMode=mode==='token'?'token':'password';clearSensitiveFields();const password=state.authMode==='password';$('password-login-fields').hidden=!password;$('credential-login-fields').hidden=password;for(const id of ['login-user-id','login-password']){$(id).disabled=!password;$(id).required=password;}$('admin-token').disabled=password;$('admin-token').required=!password;for(const [id,selected]of [['password-mode',password],['credential-mode',!password]]){$(id).className=`auth-mode-button${selected?' selected':''}`;$(id).setAttribute('aria-pressed',String(selected));}}
function accountErrorText(error){
 const messages={AUTH_REJECTED:'账号或密码不正确，或登录会话已失效。',PERMISSION_DENIED:'当前账号无权执行此操作。',AUTH_CONFLICT:'密码已被其他会话修改，请重新登录后再试。',INVALID_REQUEST:'输入不符合要求。密码须为 12–128 个字符，最多 512 字节。',RATE_LIMITED:'操作过于频繁，请稍后重试。',AUTH_UNAVAILABLE:'此服务器尚未启用账号密码功能，可先使用高级个人凭证登录。',INCOMPATIBLE_API:'此服务器尚未提供所需的账号接口，请联系组织者更新后端。',PROXY_AUTH_REQUIRED:'入口代理要求额外认证，尚未验证账号密码。请联系组织者检查入口配置。',API_UNAVAILABLE:'服务器暂不可用，请稍后检查连接。',INVALID_API_RESPONSE:'没有收到有效账号 API 响应，请检查服务器地址。',DNS_ERROR:'域名解析失败，尚未验证密码。',TLS_ERROR:'HTTPS 证书或握手失败，尚未验证密码。',CONNECTION_REFUSED:'服务器拒绝连接，请检查地址和端口，尚未验证密码。',NETWORK_UNREACHABLE:'无法连接服务器，尚未验证密码。',TIMEOUT:'请求超时，请检查网络后重试。',CANCELLED:'连接已更换，本次操作已取消。'};
 if(messages[error?.code])return messages[error.code];if(error?.name==='TimeoutError')return messages.TIMEOUT;if(error?.status===401)return messages.AUTH_REJECTED;if(error?.status===403)return messages.PERMISSION_DENIED;if(error?.status===404)return messages.AUTH_UNAVAILABLE;if(error?.status===409)return messages.AUTH_CONFLICT;if(error?.status===429)return messages.RATE_LIMITED;if(error?.status>=500)return messages.API_UNAVAILABLE;return '账号操作未完成，请检查连接状态后重试。';
}
function settingsMessage(text,error=false){$('settings-message').hidden=!text;$('settings-message').className=`notice${error?' error':''}`;setText('settings-message',text);}
function renderSettingsAccount(){
 const account=state.account,loggedIn=Boolean(state.token&&state.identity);setText('settings-account-identity',loggedIn?`${state.identity.id} · ${state.identity.role}`:'请先登录，再设置或修改密码。');
 $('password-form').hidden=!loggedIn||!account;setText('settings-account-status',!loggedIn?'尚未登录':!account?'待读取':account.passwordConfigured?'已设置密码':'未设置密码');
 setText('settings-account-note',!loggedIn?'首次设置密码：关闭设置，选择“高级：个人凭证”并登录。':!account?'打开设置时会读取此服务器的账号状态。':`${account.authentication==='password-session'?'当前使用密码登录会话':'当前使用个人凭证'}${account.sessionExpiresAt?' · 会话到期 '+date(account.sessionExpiresAt,true):''}。${state.remembered?'此设备已记住当前会话。':'当前会话未记住到本机。'}`);
 const configured=Boolean(account?.passwordConfigured);$('current-password-label').hidden=!configured;$('current-password').hidden=!configured;$('current-password').required=configured;$('current-password').disabled=!configured||state.passwordBusy;for(const id of ['new-password','confirm-password','save-password'])$(id).disabled=state.passwordBusy;setText('save-password',state.passwordBusy?'正在保存…':configured?'修改密码':'设置密码');
}
async function loadAccount(){
 if(!state.token||!state.identity){renderSettingsAccount();return;}const session=state.session,serial=++state.accountRequest;setText('settings-account-status','读取中');
 try{const account=await transport.getAccount();if(session!==state.session||serial!==state.accountRequest)return;if(typeof account?.userId!=='string'||typeof account.passwordConfigured!=='boolean')throw Object.assign(Error('Invalid account response'),{code:'INVALID_API_RESPONSE'});state.account=account;renderSettingsAccount();}
 catch(error){if(session!==state.session||serial!==state.accountRequest)return;state.account=null;renderSettingsAccount();setText('settings-account-status','暂不可用');settingsMessage(accountErrorText(error),true);if(error?.status===401&&error?.code!=='PROXY_AUTH_REQUIRED')await markConnectionFailure(error,{status:401,session});else if(['API_UNAVAILABLE','INVALID_API_RESPONSE','DNS_ERROR','TLS_ERROR','CONNECTION_REFUSED','NETWORK_UNREACHABLE','TIMEOUT'].includes(error?.code))await markConnectionFailure(Object.assign(Error(accountErrorText(error)),{code:error.code}),{session,status:error.status??0});}
}
function openSettings(){clearSensitiveFields();settingsMessage('');$('settings-api-address').value=apiUrl;$('settings-api-address').readOnly=!transport.desktop;$('settings-remember').checked=$('remember-credential').checked;$('settings-remember-label').hidden=!transport.desktop;$('settings-remember-help').textContent=transport.desktop?'此选项用于下次登录或保存密码时。只保存系统加密的会话凭证，不保存密码。':'浏览器仅在当前页面内存中保存登录会话，不保存密码。';renderSettingsAccount();renderConnectionStatus();if(!$('settings-dialog').open)$('settings-dialog').showModal();void loadAccount();}
function clearSettings(){clearSensitiveFields();state.accountRequest++;settingsMessage('');}
function closeSettings(){clearSettings();if($('settings-dialog').open)$('settings-dialog').close();}
async function savePassword(event){
 event.preventDefault();if(state.passwordBusy)return;const password=$('new-password').value,confirmation=$('confirm-password').value,currentPassword=$('current-password').value;clearSensitiveFields();settingsMessage('');
 if(!state.token||!state.account){settingsMessage('请先登录并读取账号状态。',true);return;}if(!sameApi($('settings-api-address').value,apiUrl)){settingsMessage('设置中的 API 地址已更改，请先完成新服务器登录。',true);return;}
 if(password!==confirmation){settingsMessage('两次输入的新密码不一致，请重新输入。',true);return;}if(!password.isWellFormed()||!password.trim()||Array.from(password).length<12||Array.from(password).length>128||new TextEncoder().encode(password).byteLength>512){settingsMessage('新密码须为 12–128 个字符，最多 512 字节。',true);return;}if(state.account.passwordConfigured&&!currentPassword){settingsMessage('修改密码需要输入当前密码。',true);return;}
 const session=++state.session;state.listRequest++;state.detailRequest++;state.accountRequest++;state.connectionCheck=false;state.passwordBusy=true;setConnectionStatus('checking','正在更新账号密码并验证新会话…');renderSettingsAccount();let verifyCurrent=false;
 try{const info=await transport.setPassword({password,...(state.account.passwordConfigured?{currentPassword}:{}),remember:$('settings-remember').checked});if(session!==state.session)return;if(!info?.connected)throw Object.assign(Error('Session not returned'),{code:'INVALID_API_RESPONSE'});state.identity=await request('/identity');if(session!==state.session)return;renderAuthenticatedControls(info.remembered);setLoginMode('password');await loadAccount();if(session===state.session){settingsMessage('密码已保存。当前设备使用新会话，其他密码登录会话已退出。');message('密码已更新，当前会话已重新验证。');}}
 catch(error){if(session!==state.session)return;settingsMessage(accountErrorText(error),true);if(error?.status===401&&error?.code!=='PROXY_AUTH_REQUIRED')verifyCurrent=true;else if(['API_UNAVAILABLE','INVALID_API_RESPONSE','DNS_ERROR','TLS_ERROR','CONNECTION_REFUSED','NETWORK_UNREACHABLE','TIMEOUT'].includes(error?.code))await markConnectionFailure(Object.assign(Error(accountErrorText(error)),{code:error.code}),{session,status:error.status??0});}
 finally{if(session===state.session){state.passwordBusy=false;clearSensitiveFields();renderSettingsAccount();renderConnectionStatus();if(verifyCurrent||state.connection.phase==='checking')void checkConnection(false);}}
}

function chooseGame(){const game=state.games.find(g=>g.id===$('create-game').value);$('create-rules').replaceChildren();if(!game)return;options('create-scenario',game.scenarios.map(s=>[s.id,s.name]));options('create-players',game.players.map(p=>[p,`${p} 人`]));for(const rule of game.rulesSummary??[])$('create-rules').append(node('p','',rule));if(game.implementation)$('create-rules').append(structure(game.implementation));showScenario();}
function showScenario(){const game=state.games.find(g=>g.id===$('create-game').value),scenario=game?.scenarios.find(s=>s.id===$('create-scenario').value);setText('create-scope',scenario?.description??'服务器使用随机初始局面，Agent 分别持座位凭证行动。');}
function showSeats(data){$('seat-list').replaceChildren();for(const seat of data.seats){const item=node('article','seat-card');const header=node('div','seat-heading');header.append(node('strong','',`${seat.playerId} 玩家`));const config=JSON.stringify({baseUrl:apiUrl,episodeId:data.episodeId,seatToken:seat.token},null,2),copy=node('button','button subtle','复制此玩家配置');copy.type='button';copy.onclick=async()=>{try{await transport.copyText(config);message(`已复制 ${seat.playerId} 配置，仅交给此玩家。`);}catch(error){message(error.message,true);}};header.append(copy);const details=node('details','seat-details');details.append(node('summary','','展开连接配置（含座位凭证）'),node('pre','',config));item.append(header,details);$('seat-list').append(item);}$('seat-configs').hidden=false;}
async function createEpisode(event){event.preventDefault();if(state.creating||!state.token||state.identity?.role==='auditor')return;state.creating=true;const session=state.session,button=$('create-episode');button.disabled=true;button.textContent='正在创建…';try{const data=await request('/episodes',{gameId:$('create-game').value,scenarioId:$('create-scenario').value,playerCount:Number($('create-players').value)});if(session!==state.session)return;showSeats(data);message('对局已创建。分别复制玩家配置给 Agent，然后在本页审计轨迹。');await loadList();if(session===state.session)await selectEpisode(data.episodeId);}catch(error){if(session===state.session)message(`创建请求未确认：${error.message}。若网络中断，请先刷新对局列表确认结果，再决定是否重试。`,true);}finally{if(session===state.session){state.creating=false;button.disabled=false;button.textContent='创建对局';}}}

async function selectEpisode(id){stopPlayback();clearArtifacts();clearModelMessages();const serial=++state.detailRequest;const data=await request(`/rollouts/${encodeURIComponent(id)}`);if(serial!==state.detailRequest)return;state.rollout=data;window.CoopFocus?.selected();state.index=Math.max(0,data.frames.findIndex(f=>f.action));history.replaceState(null,'',`#episode=${encodeURIComponent(id)}`);$('welcome').hidden=true;$('detail').hidden=false;options('player-view',[['actor','跟随行动者'],...data.players.map(p=>[p,`${p} 玩家`])],'actor');options('annotation-player',[['','全队'],...data.players.map(p=>[p,p])]);options('model-message-player',data.players.map(p=>[p,p]));state.modelMessagePlayer=data.players[0]??'';$('observation-mode').value='after';$('annotation-text').value='';setText('verification-result','');renderHeader();renderTimeline();renderFrame();renderAnnotations();renderRules();renderLibrary();await Promise.all([loadArtifacts(),loadModelMessages(),window.CoopFocus?.load()]);}
function renderHeader(){const s=state.rollout.summary;setText('episode-title',({hanabi:'花火 · Hanabi','take-time':'时序谜局 · Take Time'})[s.gameId]??s.gameName??state.rollout.metadata?.name??s.gameId);const scenario=state.rollout.metadata?.scenarios?.find(x=>x.id===s.scenarioId);setText('episode-subtitle',`${scenario?.name??s.scenarioId} · ${s.playerCount} 位玩家`);const result=outcome(s);setText('outcome-badge',`${isDone(s)?'终局 · ':''}${result.label}${s.outcome?.maxScore?' / '+s.outcome.maxScore:''}`);$('outcome-badge').className=`badge ${result.className}`;const stats=[['玩家',`${s.playerCount} 位 Agent`],['动作 / 事件',`${s.actionCount??0} / ${s.eventCount??state.rollout.frames.length}`],['开始时间',date(s.createdAt)],['最近更新',date(s.updatedAt)]];$('episode-stats').replaceChildren(...stats.map(([key,value])=>{const x=node('div','stat');x.append(node('div','stat-label',key),node('div','stat-value',value));return x;}));const notices=[];if(s.coverage!=='recorded')notices.push('此记录的部分历史视角未完整录制；缺失的快照会明确标注，不会用终局数据补填。');if(s.compatibleBuild===false)notices.push('引擎版本与当前服务不同：可以审阅和导出已保存轨迹；确定性重放需要原版本引擎。');$('coverage-notice').hidden=!notices.length;setText('coverage-notice',notices.join(' '));}
function renderTimeline(){const frames=state.rollout.frames;$('timeline').max=Math.max(0,frames.length-1);$('timeline').disabled=!frames.length;const strip=$('event-strip');const scroll=strip.scrollLeft;strip.replaceChildren(...frames.map((frame,i)=>{const chip=node('button',`event-chip${isRejected(frame)?' rejected':''}${i===state.index?' selected':''}`);chip.dataset.index=i;chip.setAttribute('role','listitem');chip.title=`${date(frame.at,true)} · ${frame.playerId??'系统'} · ${actionName(frame)}`;chip.append(node('span','',`#${frame.seq} · ${frame.playerId??'系统'}`),node('strong','',actionName(frame)));chip.querySelector('strong').setAttribute('data-step',String(frame.seq));chip.onclick=()=>{stopPlayback();selectFrame(i);};return chip;}));strip.scrollLeft=scroll;}
function selectFrame(index){state.index=Math.max(0,Math.min(index,state.rollout.frames.length-1));renderFrame();}
function currentFrame(){return state.rollout?.frames[state.index];}
function renderFrame(){const frame=currentFrame();const frames=state.rollout.frames;$('timeline').value=state.index;setText('frame-counter',frames.length?`#${frame?.seq}`:'');setText('step-label',`${frames.length?state.index+1:0} / ${frames.length}`);setText('frame-time',date(frame?.at));$('previous').disabled=state.index<=0;$('next').disabled=state.index>=frames.length-1;$('play').disabled=frames.length<2;for(const chip of $('event-strip').children)chip.classList.toggle('selected',Number(chip.dataset.index)===state.index);keepEventVisible();renderBoard();renderEvidence();renderDiscussion();window.CoopFocus?.render();}
function keepEventVisible(){const strip=$('event-strip'),chip=strip.children[state.index];if(!chip)return;const bounds=strip.getBoundingClientRect(),selected=chip.getBoundingClientRect();if(selected.left<bounds.left)strip.scrollLeft-=bounds.left-selected.left;else if(selected.right>bounds.right)strip.scrollLeft+=selected.right-bounds.right;}
function recordedObservation(frame){if(!frame)return {observation:null,reason:'此记录尚无可审阅事件。'};const following=$('player-view').value==='actor';const player=following?(frame.playerId??state.rollout.players.find(p=>frame.views?.[p])??state.rollout.players[0]??'p1'):$('player-view').value;const mode=following?'跟随行动者 · ':'';const before=$('observation-mode').value==='before';if(before){if(!frame.playerId)return {observation:null,reason:`${mode}系统事件没有行动玩家，也没有玩家动作前精确输入。`};if(frame.playerId!==player)return {observation:null,reason:`本事件的动作前输入属于 ${frame.playerId}。未记录 ${player} 在此刻的精确决策输入；请切换到行动者。`};if(!frame.observed)return {observation:null,reason:`${mode}${player} · 未保存此事件绑定的动作前观察。历史记录不会由当前引擎补造。`};return {observation:frame.observed,reason:`${mode}${player} · 动作前精确输入 · observationId: ${frame.observed.observationId??'未记录'}。这是本动作实际绑定的观察。`};}const observed=frame.views?.[player];if(!observed)return {observation:null,reason:`${mode}未录制 ${player} 在本事件后的视角。可切换到其他玩家，或查看行动者的动作前输入。`};const source=frame.viewProvenance?.[player];return {observation:observed,reason:`${mode}${player} · 动作后状态 · ${source==='issued-observation'?'当时实际签发的玩家观察':source==='server-projection'?'服务器记录的玩家可见状态投影（不表示 Agent 曾主动读取）':'服务器保存的历史玩家视角'}。`};}
function renderBoard(){const {observation,reason}=recordedObservation(currentFrame());setText('view-caption',reason);$('board').replaceChildren();setText('raw-observation',observation?JSON.stringify(observation,null,2):'此时点没有此玩家的已记录观察。');if(!observation){$('board').append(node('div','empty-state','此玩家的历史视角不可用'));return;}const view=observation.view;if(!view||typeof view!=='object'){$('board').append(node('div','empty-state','记录中没有可视化状态。'));return;}if(state.rollout.summary.gameId==='take-time')renderTakeTime(view);else renderGeneric(view);}
function playingCard(card,owner='',visibility=''){const known=typeof card.value==='number';const color=card.color==='lunar'?'lunar':'solar';const el=node('div',`game-card ${color}${known?'':' hidden-card'}`);el.dataset.known=String(known);el.setAttribute('aria-label',`${color==='lunar'?'月亮':'太阳'} ${known?card.value:'暗牌数值未知'}${visibility?' · '+visibility:''}${owner?' · '+owner:''}`);el.title=el.getAttribute('aria-label');el.append(node('span','card-symbol',color==='lunar'?'☾':'☀'),node('span','card-value',known?card.value:'?'));if(owner)el.append(node('span','card-owner',owner));if(visibility)el.append(node('span','card-visibility',visibility));return el;}
function renderTakeTime(view){const board=$('board');const phases=node('div','phase-strip');for(const text of [phaseNames[view.phase]??view.phase,view.phase==='finished'?'全部出牌完成':view.currentPlayerId?`轮到 ${view.currentPlayerId}`:view.activePlayerIds?.length?`可行动 ${view.activePlayerIds.join(' / ')}`:'无待行动玩家',`剩余明置 ${view.faceUpRemaining??'—'} 次`])phases.append(node('span','phase-tag',text));board.append(phases);renderPublicCardBacks(view,board);const clock=node('div','clock-board');const own=new Map((view.ownPlacements??[]).map(p=>[p.turn,p.card]));for(let position=1;position<=6;position++){const slot=node('div','clock-slot');slot.dataset.position=position;const heading=node('div','slot-heading');heading.append(node('span','slot-number',String(position).padStart(2,'0')),node('span','slot-rule',position===1?'恰好 1 张太阳牌':position===6?'恰好 3 张牌':'至少 1 张 · 总和不递减'));slot.append(heading);const cards=node('div','slot-cards');let knownSum=0,unknown=0;const placements=(view.placements??[]).filter(p=>p.position===position);for(const placement of placements){const ownCard=placement.playerId===view.playerId?own.get(placement.turn):null;const value=typeof placement.value==='number'?placement.value:ownCard?.value;const visibility=view.phase==='finished'?'揭晓':placement.faceUp?'明':typeof value==='number'?'己知':'暗';if(typeof value==='number')knownSum+=value;else unknown++;cards.append(playingCard({...placement,value},placement.playerId,visibility));}if(!placements.length)cards.append(node('span','slot-empty','尚未放牌'));slot.append(cards);const sum=node('div','slot-sum');sum.append(node('span','',`${placements.length} 张 · ${unknown?'已知部分':'合计'}`),node('strong','',unknown?`${knownSum} + ? × ${unknown}`:String(knownSum)));slot.append(sum);clock.append(slot);}board.append(clock);const section=node('div','hand-section');const heading=node('div','hand-heading');heading.append(node('h3','',`${view.playerId} 的手牌`),node('span','muted small',view.hand===null?'尚未看牌 · 只展示牌背':`${view.hand?.length??0} 张剩余`));section.append(heading);const hand=node('div','hand-cards');if(Array.isArray(view.hand)){for(const card of view.hand)hand.append(playingCard(card));if(!view.hand.length)hand.append(node('span','muted small','手牌已全部打出。'));}else{for(const color of view.cardBacks?.[view.playerId]?.hand??[])hand.append(playingCard({color,value:null}));if(!hand.children.length)hand.append(node('span','muted small','手牌未记录。'));}section.append(hand);board.append(section);if(view.result){const result=node('div',`result-strip${view.result.won?'':' loss'}`);result.append(node('strong','',view.result.won?'✓ 团队获胜':'团队失败'),node('p','',`六格总和：${(view.result.sums??[]).join(view.result.won?' ≤ ':' / ')}`));for(const violation of view.result.violations??[])result.append(node('p','',violation));board.append(result);}}
function primitive(value){if(value===null||value===undefined)return '未知 / 未提供';if(value===true)return '是';if(value===false)return '否';return String(value);}
function renderPublicCardBacks(view,board){
 const section=node('section','public-card-backs');section.append(node('h3','','本步公开牌背 · 所有玩家'));
 section.append(node('p','muted small',view.phase==='discussion'?'讨论前即可看到牌背颜色和数量；手牌数字仍不可见。':'仅使用这个时点记录的公开牌背；出牌后剩余数量会变化。'));
 const grid=node('div','card-back-grid');
 for(const player of state.rollout.players){
  const backs=view.cardBacks?.[player];
  const count=key=>{const saved=view.cardColorCounts?.[player]?.[key];if(saved&&Number.isInteger(saved.solar)&&Number.isInteger(saved.lunar))return saved;const colors=backs?.[key];return Array.isArray(colors)?{solar:colors.filter(c=>c==='solar').length,lunar:colors.filter(c=>c==='lunar').length}:null;};
  const hand=count('hand'),reserve=count('reserve');const item=node('div','card-back-player');item.dataset.player=player;
  item.append(node('strong','',player),node('span','',hand?`☀ 太阳 ${hand.solar} 张 · ☾ 月亮 ${hand.lunar} 张`:'此时点未记录牌背数量'));
  if(reserve&&(reserve.solar+reserve.lunar)>0)item.append(node('span','muted small',`保留牌：太阳 ${reserve.solar} 张 · 月亮 ${reserve.lunar} 张`));
  if(Array.isArray(view.lookedPlayerIds))item.append(node('span','muted small',view.lookedPlayerIds.includes(player)?'已看数字牌面 · 禁言':'尚未看数字牌面'));
  grid.append(item);
 }
 section.append(grid);board.append(section);
}
function renderIdentity(){
 const identity=state.identity;if(!identity)return;
 setText('identity-permissions',identity.role==='auditor'?`当前身份 ${identity.id}：可查看已结束对局、下载已完成附件、写审阅笔记。`:`当前身份 ${identity.id}：可创建和结束对局、审阅全组轨迹、下载附件、导出与重放。请单独向 Agent 提供座位凭证。`);
 $('identity-permissions').hidden=false;renderRetention(identity.retention);
}
function clearModelMessages(clearPlayers=true){
 state.modelMessageRequest++;state.modelMessages=[];state.modelMessageLoading=false;state.modelMessageError='';state.modelMessagePlayer='';state.modelMessagePage=0;state.modelMessageCursors=[-1];state.modelMessageNextAfter=-1;state.modelMessageHasMore=false;state.modelMessageCompletion=null;
 $('model-messages').replaceChildren();setText('model-message-count',0);setText('model-message-status','');$('model-message-status').hidden=true;setText('model-message-page','每页 25 条');
 if(clearPlayers)$('model-message-player').replaceChildren();$('previous-model-messages').disabled=true;$('next-model-messages').disabled=true;$('refresh-model-messages').disabled=false;
}
async function loadModelMessages(direction='current'){
 const episodeId=state.rollout?.summary.episodeId,player=state.modelMessagePlayer;if(!episodeId||!player||!state.token)return;
 let page=state.modelMessagePage,after=state.modelMessageCursors[page]??-1;
 if(direction==='next'){if(!state.modelMessageHasMore)return;page++;after=state.modelMessageNextAfter;}
 if(direction==='previous'){if(page===0)return;page--;after=state.modelMessageCursors[page]??-1;}
 const serial=++state.modelMessageRequest,session=state.session;state.modelMessageLoading=true;state.modelMessageError='';renderModelMessages();
 try{
  const query=new URLSearchParams({playerId:player,after:String(after),limit:'25'});
  const data=await request(`/rollouts/${encodeURIComponent(episodeId)}/messages?${query}`);
  if(serial!==state.modelMessageRequest||session!==state.session||state.rollout?.summary.episodeId!==episodeId||state.modelMessagePlayer!==player)return;
  if(!Array.isArray(data.messages)||data.messages.length>25)throw Error('服务器返回的消息分页格式不正确。');
  state.modelMessages=data.messages;state.modelMessagePage=page;state.modelMessageCursors[page]=after;state.modelMessageNextAfter=data.nextAfter;state.modelMessageHasMore=data.hasMore===true&&Number.isSafeInteger(data.nextAfter)&&data.nextAfter>after;state.modelMessageCompletion=data.completion??null;
 }catch(error){if(serial!==state.modelMessageRequest||session!==state.session)return;state.modelMessageError=/RATE_LIMITED|RESOURCE_LIMIT|429/.test(error.message)?'服务端暂时限制了读取频率。已加载消息仍保留，请稍后点击“刷新消息”重试。':error.message;}
 finally{if(serial===state.modelMessageRequest&&session===state.session){state.modelMessageLoading=false;renderModelMessages();}}
}
function reasoningLabel(value){return ({provided:'已提供（客户端声明）','summary-only':'仅摘要 · 不含完整推理原文','not-provided':'未提供推理原文',redacted:'推理内容已删减'})[value]??'未声明推理内容可用性';}
function lazyMessageDetails(title,value){
 const details=node('details','raw-details model-message-raw');details.append(node('summary','',title));const pre=node('pre');details.append(pre);
 // Preserve full uploaded values without building every long JSON block in DOM.
 details.addEventListener('toggle',()=>{pre.textContent=details.open?(typeof value==='string'?value:JSON.stringify(value,null,2)):'';});return details;
}
function uploadedReasoningFields(message){
 if(!message||typeof message!=='object')return [];
 const fields=[],nonempty=value=>value!==null&&value!==undefined&&value!==''&&(!Array.isArray(value)||value.length>0);
 const inspect=(value,path)=>{
  if(!value||typeof value!=='object')return;
  for(const key of ['reasoning_content','reasoning'])if(nonempty(value[key]))fields.push({path:`${path}.${key}`,classification:typeof value[key]==='string'?'uploaded text':'structured field; inspect original',value:value[key]});
  if(Array.isArray(value.content))for(const [index,block] of value.content.entries())if(block&&typeof block==='object'&&['thinking','reasoning','reasoning_text','redacted_thinking'].includes(block.type))fields.push({path:`${path}.content[${index}]`,classification:block.type==='redacted_thinking'?'redacted; not readable reasoning':'structured field; inspect original',value:block});
 };
 inspect(message,'message');inspect(message.raw,'message.raw');
 if(Array.isArray(message.raw?.choices))for(const [index,choice]of message.raw.choices.entries())inspect(choice?.message,`message.raw.choices[${index}].message`);
 if(Array.isArray(message.raw?.output))for(const [index,item]of message.raw.output.entries())if(item?.type==='reasoning'){
  if(nonempty(item.summary))fields.push({path:`message.raw.output[${index}].summary`,classification:'summary only; not full reasoning',value:item.summary});
  if(nonempty(item.encrypted_content))fields.push({path:`message.raw.output[${index}].encrypted_content`,classification:'opaque encrypted content; not readable reasoning',value:item.encrypted_content});
 }
 return fields;
}
function renderModelMessages(){
 const list=$('model-messages');list.replaceChildren();setText('model-message-count',`${state.modelMessages.length} 条 / 本页`);
 $('refresh-model-messages').disabled=state.modelMessageLoading;$('previous-model-messages').disabled=state.modelMessageLoading||state.modelMessagePage===0;$('next-model-messages').disabled=state.modelMessageLoading||!state.modelMessageHasMore;
 setText('model-message-page',`第 ${state.modelMessagePage+1} 页 · 每页 25 条${state.modelMessageLoading?' · 读取中':''}`);
 const completion=state.modelMessageCompletion,status=$('model-message-status');status.hidden=false;
 if(completion){
  const complete=completion.completeness==='complete';status.className=`notice${complete?'':' error'}`;
  const details=[`${state.modelMessagePlayer} · ${complete?'已封存，客户端声明采集完整':'已封存，采集不完整（partial）'}`,`推理：${reasoningLabel(completion.reasoningAvailability)}`,`范围：${completion.scope??'未声明'}`,`封存时间：${date(completion.sealedAt,true)}`];
  if(Array.isArray(completion.unavailable)&&completion.unavailable.length)details.push(`未获取内容：${completion.unavailable.join('；')}`);
  details.push('封存和顺序校验不代表服务器验证了模型来源或语义完整性。');setText('model-message-status',details.join(' · '));
 }else{status.className='notice';setText('model-message-status','尚未收到本玩家的采集完成声明；当前消息可能仍在上传，不能据此判断采集完整。');}
 if(state.modelMessageError)list.append(node('div','notice error',`消息暂不可用：${state.modelMessageError}`));
 if(state.modelMessageLoading&&!state.modelMessages.length){list.append(node('div','empty-state','正在读取所选玩家的模型消息…'));return;}
 if(!state.modelMessages.length&&!state.modelMessageError){list.append(node('div','empty-state',state.modelMessagePage===0?'本局尚无完整模型消息上传；下方工具附件不是完整模型输入输出。':'这一页没有更多已上传消息。'));return;}
 for(const item of state.modelMessages){
  const card=node('article','model-message');card.dataset.messageSequence=item.sequence;
  const head=node('div','model-message-heading');head.append(node('strong','',`#${item.sequence} · ${state.modelMessagePlayer} · ${item.kind??'model-message'}`),node('span','badge neutral role-badge',item.message?.role??'role 未提供'));card.append(head);
  card.append(node('p','model-message-times',`服务器收到：${date(item.serverReceivedAt,true)}\n客户端时间（声明）：${date(item.clientAt,true)}`));
  const fields=node('dl','model-message-fields'),field=(key,value)=>{fields.append(node('dt','',key),node('dd','',value));};
  field('Message ID',item.messageId??'未提供');field('观察 ID',item.observationId??'未关联');field('请求 ID',item.requestId??'未关联');
  field('模型 / 提供方',[item.model,item.provider].filter(Boolean).join(' / ')||'未提供');field('Token 用量',item.tokenUsage!==undefined?JSON.stringify(item.tokenUsage):'未提供');field('来源','客户端实际上传 · 未经服务器核验');card.append(fields);
  const reasoning=uploadedReasoningFields(item.message);
  let note=reasoningLabel(item.reasoningAvailability);
  if(reasoning.length)note+='。此条包含 reasoning / thinking 相关字段，可展开核对原样内容；字段名不证明它是模型完整内部思维。';
  else note+='。此条已识别的位置未上传 reasoning / thinking 字段原文；未知提供方格式请展开原始 message 核对。即使 token 用量含 reasoning 计数，也不能还原原文。';
  if(reasoning.some(field=>field.classification.startsWith('summary only')))note+=' summary 仅为摘要，不是完整推理。';
  if(reasoning.some(field=>field.classification.startsWith('opaque encrypted')))note+=' encrypted_content 是不透明的加密内容，不能作为可读推理。';
  card.append(node('p',`reasoning-note${reasoning.length&&item.reasoningAvailability==='provided'?' provided':''}`,note));
  if(reasoning.length)card.append(lazyMessageDetails('查看上传的 reasoning / thinking 字段（原样）',reasoning));
  const capture=item.message?.capture,fragment=capture?.fragment===true||capture?.encoding==='base64';
  if(fragment)card.append(node('p','reasoning-note',`原始消息分片：${Number.isInteger(capture.index)?capture.index+1:'?'} / ${capture.count??'?'}。单片不代表完整模型输入输出，也不是可读推理；需按 logicalId、片序与 SHA-256 重组原始文件。`));
  card.append(lazyMessageDetails(fragment?'展开已上传分片 message（安全文本）':'展开完整原始 message（安全文本）',item.message));
  list.append(card);
 }
}
function renderRetention(retention){
 if(!retention)return;
 setText('retention-policy',retention.automaticDeletion===false?'长期保存：服务器不自动删除轨迹和附件；达到容量上限时拒绝新增写入，保留已存数据。扩容和备份由组织者维护。':'保存策略：'+JSON.stringify(retention));
}
function formatBytes(value){if(!Number.isFinite(value))return '大小未记录';if(value<1024)return `${value} B`;if(value<1024*1024)return `${(value/1024).toFixed(1)} KiB`;return `${(value/(1024*1024)).toFixed(1)} MiB`;}
function clearArtifacts(){
 state.artifactRequest++;state.artifacts=[];state.artifactLoading=false;state.artifactError='';
 for(const controller of state.downloadControllers)controller.abort();state.downloadControllers.clear();
 for(const url of state.downloadUrls)URL.revokeObjectURL(url);state.downloadUrls.clear();
 $('artifacts').replaceChildren();setText('artifact-count',0);
}
async function loadArtifacts(){
 const episodeId=state.rollout?.summary.episodeId;if(!episodeId||!state.token)return;
 const serial=++state.artifactRequest,session=state.session;state.artifactLoading=true;state.artifactError='';renderArtifacts();
 try{
  const data=await request(`/rollouts/${encodeURIComponent(episodeId)}/artifacts`);
  if(serial!==state.artifactRequest||session!==state.session||state.rollout?.summary.episodeId!==episodeId)return;
  state.artifacts=Array.isArray(data.artifacts)?data.artifacts:[];renderRetention(data.retention);
 }catch(error){if(serial!==state.artifactRequest||session!==state.session)return;state.artifactError=error.message;}
 finally{if(serial===state.artifactRequest&&session===state.session){state.artifactLoading=false;renderArtifacts();}}
}
function renderArtifacts(){
 const list=$('artifacts');list.replaceChildren();setText('artifact-count',state.artifacts.length);
 if(state.artifactLoading&&!state.artifacts.length){list.append(node('div','empty-state','正在读取附件清单…'));return;}
 if(state.artifactError)list.append(node('div','notice error',`附件清单暂不可用：${state.artifactError}`));
 if(!state.artifacts.length&&!state.artifactError){list.append(node('div','empty-state','尚无 Agent 原始轨迹附件。服务端动作记录与这些附件分开保存；附件需由 Agent 显式上传。'));return;}
 const reasoningNames={provided:'上传者声明：已提供推理内容','summary-only':'上传者声明：仅决策摘要','not-provided':'上传者声明：未提供推理内容',redacted:'上传者声明：推理内容已删减'};
 for(const artifact of state.artifacts){
  const card=node('article','artifact-card');card.dataset.artifactId=artifact.id;
  const header=node('div','artifact-heading');header.append(node('strong','artifact-name',artifact.name));const complete=artifact.status==='complete';header.append(node('span',`badge ${complete?'':'neutral'}`,complete?'已保存':'上传中'));card.append(header);
  card.append(node('p','artifact-meta',`${artifact.playerId} · ${artifact.mediaType} · ${formatBytes(artifact.byteLength)} · ${date(artifact.completedAt??artifact.createdAt,true)}`));
  if(!complete)card.append(node('p','muted small',`已接收 ${artifact.receivedChunks?.length??0} / ${artifact.chunkCount??'?'} 块，完成校验前不可下载。`));
  const details=node('dl','artifact-fields');
  const field=(key,value)=>{details.append(node('dt','',key),node('dd','',value));};
  field('SHA-256',artifact.sha256??'未提供');
  field('来源','客户端上传 · 内容及声明未经核验');
  if(artifact.model||artifact.provider)field('模型 / 提供方',[artifact.model,artifact.provider].filter(Boolean).join(' / '));
  field('推理内容',reasoningNames[artifact.reasoningAvailability]??'上传者未声明可用性');
  if(artifact.tokenCounts)field('Token 数（声明）',JSON.stringify(artifact.tokenCounts));
  card.append(details);
  const download=node('button','button subtle','下载原始文件 ↓');download.type='button';download.disabled=!complete;download.dataset.downloadArtifact=artifact.id;
  download.onclick=async()=>{const session=state.session,episodeId=state.rollout?.summary.episodeId;download.disabled=true;try{await downloadArtifact(artifact,episodeId);}catch(error){if(session===state.session&&episodeId===state.rollout?.summary.episodeId)message(`附件下载失败：${error.message}`,true);}finally{if(download.isConnected)download.disabled=!complete;}};
  card.append(download);list.append(card);
 }
}
async function downloadArtifact(artifact,episodeId){
 if(!episodeId||artifact.status!=='complete')return;
 if(!Number.isSafeInteger(artifact.byteLength)||artifact.byteLength<0||artifact.byteLength>64*1024*1024)throw Error('附件大小超出浏览器下载支持范围（64 MiB）。');
 const session=state.session,controller=new AbortController();state.downloadControllers.add(controller);const timeout=setTimeout(()=>controller.abort(),120000);
 const valid=()=>session===state.session&&episodeId===state.rollout?.summary.episodeId&&!controller.signal.aborted;
 try{
  const response=await transport.request(`/api/v1/rollouts/${encodeURIComponent(episodeId)}/artifacts/${encodeURIComponent(artifact.id)}/content`,{signal:controller.signal});
  if(!valid())return;
  if(!response.ok){const error=Object.assign(Error(`服务器返回 HTTP ${response.status}`),{status:response.status});await markConnectionFailure(error,{status:response.status,session});throw error;}
  const reader=response.body.getReader(),parts=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;if(!valid()){await reader.cancel();return;}size+=value.byteLength;if(size>artifact.byteLength){await reader.cancel();throw Error('下载内容超过清单记录的字节数。');}parts.push(value);}
  if(!valid())return;if(size!==artifact.byteLength)throw Error('下载未完整传输，请重试。');
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));const hash=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
  if(!valid())return;if(hash!==artifact.sha256)throw Error('SHA-256 校验不匹配，文件未导出。');
  const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));state.downloadUrls.add(url);
  const link=node('a');link.href=url;link.download=String(artifact.name??`artifact-${artifact.id}`).replace(/[\\/\x00-\x1f\x7f]/g,'_');document.body.append(link);link.click();link.remove();
  setTimeout(()=>{URL.revokeObjectURL(url);state.downloadUrls.delete(url);},1000);message('已下载原始附件，字节数和 SHA-256 校验通过。');
 }catch(error){if(valid())await markConnectionFailure(error,{session,status:Number(error?.status??0)});throw error;}finally{clearTimeout(timeout);state.downloadControllers.delete(controller);}
}
function structure(value,depth=0){if(value===null||typeof value!=='object')return node('span','field-value',primitive(value));if(Array.isArray(value)){const container=node('div',value.every(v=>v===null||typeof v!=='object')?'field-array':'field-nested');if(!value.length)return node('span','muted small','空');for(const item of value.slice(0,36)){if(item===null||typeof item!=='object')container.append(node('span','data-chip',primitive(item)));else{const child=node('div','field-object');child.append(structure(item,depth+1));container.append(child);}}if(value.length>36)container.append(node('span','field-overflow',`另有 ${value.length-36} 项，见原始观察`));return container;}const container=node('div','field-nested');const entries=Object.entries(value);if(!entries.length)return node('span','muted small','空');for(const [key,item]of entries.slice(0,30)){const row=node('div','field-entry');row.append(node('span','field-label',labels[key]??key));if(depth>=3&&item!==null&&typeof item==='object')row.append(node('span','field-value',Array.isArray(item)?`${item.length} 项（展开原始观察查看）`:'嵌套对象（展开原始观察查看）'));else row.append(structure(item,depth+1));container.append(row);}return container;}
function renderGeneric(view){const grid=node('div','field-grid');for(const [key,value]of Object.entries(view)){if(['rules','legalActions','discussion'].includes(key))continue;const card=node('section','field-card');card.append(node('div','field-label',labels[key]??key),structure(value));grid.append(card);}$('board').append(grid);}
function renderEvidence(){const frame=currentFrame();setText('event-title',frame?`${frame.playerId??'系统'} · ${actionName(frame)}`:'没有事件');setText('event-kind',isRejected(frame)?'被拒绝':frame?.kind??'—');$('event-kind').className=`badge ${isRejected(frame)?'danger':'neutral'}`;setText('event-meta',frame?`事件 #${frame.seq} · ${date(frame.at,true)}`:'');const content=$('event-content');content.replaceChildren();if(!frame)return;function block(label,text,className=''){const box=node('div','evidence-block');box.append(node('div','evidence-label',label),node('p',`evidence-text ${className}`,text));content.append(box);}if(frame.action?.text)block('公开消息原文',frame.action.text);if(frame.error){const error=frame.error;content.append(node('div','error-box',`${error.code??'操作失败'}：${error.message??JSON.stringify(error)}`));}block('行动时的决策简述',frame.decisionSummary||'没有记录决策简述。',frame.decisionSummary?'decision-box':'');if(frame.action?.position!==undefined)block('行动结果',`${frame.playerId} 请求放到第 ${frame.action.position} 格 · ${frame.action.faceUp?'明置':'暗置'}${isRejected(frame)?'（未执行）':''}`);if(frame.observed?.observationId)block('动作绑定观察',frame.observed.observationId);setText('event-json',JSON.stringify({seq:frame.seq,kind:frame.kind,playerId:frame.playerId,action:frame.action,error:frame.error,stateHash:frame.stateHash,coverage:frame.coverage,viewProvenance:frame.viewProvenance},null,2));}
function publicCommunication(frame){
 if(frame.kind!=='accepted'||isRejected(frame))return null;
 const action=frame.action??{};
 if(['speak','message','chat'].includes(action.type))return typeof action.text==='string'?action.text:null;
 if(action.type==='hint')return `向 ${action.target} 提示${action.kind==='color'?'颜色':'数值'}：${action.value}`;
 if(action.type==='signal')return `向 ${action.target} 放置“做点什么”提醒标记。`;
 if(action.type==='communicate'){
   // Communication reveals this card publicly. Only use this event's saved view.
   const view=frame.views?.[frame.playerId]?.view;
   const card=view?.communication?.[frame.playerId]?.card;
   const relation={highest:'该花色中最大',lowest:'该花色中最小',only:'该花色唯一一张'}[action.relation]??action.relation;
   return card?`公开任务沟通：${card.suit??card.color??''} ${card.value??card.rank??''} · ${relation}`:`公开任务沟通：${JSON.stringify({cardId:action.cardId,relation})}`;
 }
 // Private commitments (for example distress_pass) are not public messages.
 return null;
}
function renderDiscussion(){const limit=$('observation-mode').value==='before'?state.index-1:state.index;const messages=state.rollout.frames.slice(0,limit+1).map(frame=>({frame,text:publicCommunication(frame)})).filter(item=>item.text!==null);const total=state.rollout.frames.filter(frame=>publicCommunication(frame)!==null).length;setText('discussion-count',`本步 ${messages.length} 条 / 全局 ${total} 条`);const takeTime=state.rollout.summary.gameId==='take-time';setText('discussion-context',takeTime?'玩家可从各地通过 API 在讨论阶段发送 speak、拉取观察读取消息；讨论时可看所有人的太阳 / 月亮牌背数量。每位玩家看数字后必须禁言，未看牌者仍可讨论；全部看牌后开始出牌。':'仅展示截至所选时点已经发生的公开消息和合法沟通动作。');$('discussion').replaceChildren();if(!messages.length){const text=total?'截至此时间点尚无公开沟通；后续消息请沿时间线查看。':isDone(state.rollout.summary)?'这局没有已记录的公开沟通动作。示范程序可以直接看牌而跳过讨论；这不表示环境缺少沟通 API。':'这局尚未记录公开沟通。支持讨论的阶段中，玩家通过 API 发送消息后会显示在这里。';$('discussion').append(node('div','empty-state',text));return;}for(const {frame,text} of messages){const speech=node('article',`speech${frame.seq===currentFrame()?.seq?' selected':''}`);const player=frame.playerId??'系统';speech.append(node('div',`avatar ${/^p\d+$/.test(player)?player:''}`,player));const body=node('div','');const meta=node('div','speech-meta');meta.append(node('span','',`${player} · ${actionName(frame)} · #${frame.seq}`),node('time','',date(frame.at,true)));body.append(meta,node('p','speech-text',text));speech.append(body);$('discussion').append(speech);}}
function renderAnnotations(){const annotations=state.rollout.annotations??[];setText('annotation-count',annotations.length);$('annotations').replaceChildren();if(!annotations.length)$('annotations').append(node('div','empty-state','还没有审阅笔记或赛后反思。'));for(const annotation of annotations){const item=node('article','annotation');item.append(node('div','annotation-meta',`${annotation.kind==='reflection'?'赛后反思':'审阅笔记'} · ${annotation.playerId??'全队'} · ${annotation.source==='seat'?'玩家提交':'协调者提交'}\n${date(annotation.createdAt,true)}`),node('p','',annotation.text));$('annotations').append(item);}const enabled=isDone(state.rollout.summary);for(const id of ['annotation-kind','annotation-player','annotation-text','save-annotation'])$(id).disabled=!enabled;setText('annotation-hint',enabled?'笔记写入服务器，重新打开仍可查看。':'对局结束后可以保存审阅与反思。');}
function renderRules(){const metadata=state.rollout.metadata??{};const rules=$('rules');rules.replaceChildren();for(const instruction of metadata.rulesSummary??[])rules.append(node('p','',instruction));if(metadata.implementation){rules.append(node('h3','','实现范围'));rules.append(structure(metadata.implementation));}}
function stopPlayback(){if(state.playing)clearInterval(state.playing);state.playing=null;setText('play','▶ 播放');$('play').setAttribute('aria-label','播放回放');}
function startPlayback(){if(!state.rollout?.frames.length)return;if(state.index>=state.rollout.frames.length-1)selectFrame(0);setText('play','Ⅱ 暂停');$('play').setAttribute('aria-label','暂停回放');state.playing=setInterval(()=>{if(state.index>=state.rollout.frames.length-1){stopPlayback();return;}selectFrame(state.index+1);},1000);}
async function refreshDetail(){const previous=state.rollout;if(!previous||state.playing)return;const id=previous.summary.episodeId;const serial=state.detailRequest;const data=await request(`/rollouts/${encodeURIComponent(id)}`);if(state.playing||serial!==state.detailRequest||state.rollout?.summary.episodeId!==id)return;const selectedSeq=currentFrame()?.seq;state.rollout=data;const index=data.frames.findIndex(frame=>frame.seq===selectedSeq);state.index=index<0?Math.min(state.index,Math.max(0,data.frames.length-1)):index;renderHeader();renderTimeline();renderFrame();renderAnnotations();}
async function refresh(){await loadList();await refreshDetail();await Promise.all([loadArtifacts(),loadModelMessages(),window.CoopFocus?.load()]);}
$('login-form').addEventListener('submit',async event=>{event.preventDefault();const button=$('connect-button');if(button.disabled)return;button.disabled=true;const mode=state.authMode,userId=$('login-user-id').value.trim(),password=$('login-password').value,token=$('admin-token').value;clearSensitiveFields();try{if(mode==='password')await loginWithPassword(userId,password);else await connect(token);}catch{}finally{button.disabled=false;}});
$('auth-toggle').onclick=()=>{$('auth-panel').hidden=!$('auth-panel').hidden;if(!$('auth-panel').hidden)$(state.authMode==='password'?'login-password':'admin-token').focus();};
$('password-mode').onclick=()=>setLoginMode('password');$('credential-mode').onclick=()=>setLoginMode('token');$('settings-open').onclick=openSettings;$('settings-close').onclick=closeSettings;$('settings-dialog').addEventListener('close',clearSettings);$('settings-dialog').addEventListener('cancel',clearSettings);$('password-form').addEventListener('submit',savePassword);$('settings-remember').onchange=()=>{$('remember-credential').checked=$('settings-remember').checked;};$('remember-credential').onchange=()=>{$('settings-remember').checked=$('remember-credential').checked;};$('settings-check').onclick=async()=>{if(!sameApi($('settings-api-address').value,apiUrl)){settingsMessage('新地址尚未登录，请点击“使用此地址登录”。',true);return;}await checkConnection(true);};$('settings-apply-address').onclick=()=>{const address=$('settings-api-address').value.trim();closeSettings();$('api-address').value=address;$('auth-panel').hidden=false;renderConnectionStatus();$(state.authMode==='password'?'login-password':'admin-token').focus();};
$('disconnect').onclick=async()=>{try{await disconnect();message('已退出，设备上保存的凭证及当前轨迹缓存已清除。');}catch(error){message(error.message,true);}};
$('api-address').addEventListener('input',()=>renderConnectionStatus());$('check-connection').onclick=()=>checkConnection(true);
$('create-form').addEventListener('submit',createEpisode);$('create-game').onchange=chooseGame;$('create-scenario').onchange=showScenario;$('hide-seats').onclick=()=>{$('seat-list').replaceChildren();$('seat-configs').hidden=true;};
$('refresh-model-messages').onclick=()=>loadModelMessages();$('previous-model-messages').onclick=()=>loadModelMessages('previous');$('next-model-messages').onclick=()=>loadModelMessages('next');$('model-message-player').onchange=()=>{const player=$('model-message-player').value;clearModelMessages(false);state.modelMessagePlayer=player;loadModelMessages();};
guarded('refresh',refresh);guarded('refresh-artifacts',loadArtifacts);guarded('load-more',()=>loadList(true));for(const id of ['filter-game','filter-status'])$(id).onchange=()=>loadList().catch(e=>message(e.message,true));
$('previous').onclick=()=>{stopPlayback();selectFrame(state.index-1);};$('next').onclick=()=>{stopPlayback();selectFrame(state.index+1);};$('play').onclick=()=>state.playing?stopPlayback():startPlayback();$('timeline').oninput=()=>{stopPlayback();selectFrame(Number($('timeline').value));};for(const id of ['player-view','observation-mode'])$(id).onchange=()=>renderFrame();
guarded('copy-api',async()=>{await transport.copyText(apiUrl);message(`已复制 Agent API：${apiUrl}`);});
guarded('export-rollout',async()=>{if(!state.rollout)return;const url=URL.createObjectURL(new Blob([JSON.stringify(state.rollout,null,2)],{type:'application/json'}));const link=node('a');link.href=url;link.download=`rollout-${state.rollout.summary.episodeId}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('已导出服务器保存的 Rollout，包括已记录视角、动作和审阅笔记。');});
guarded('verify-replay',async()=>{if(!state.rollout)return;const session=state.session,id=state.rollout.summary.episodeId,valid=()=>session===state.session&&id===state.rollout?.summary.episodeId;setText('verification-result','正在验证…');try{const result=await request(`/episodes/${encodeURIComponent(id)}/replay`);if(valid())setText('verification-result',JSON.stringify(result,null,2));}catch(error){if(valid())setText('verification-result',error.message.includes('BUILD_MISMATCH')?'引擎版本不匹配：本次无法重新执行验证。已保存轨迹仍可审阅、导出；请使用记录对应的引擎版本重放。':error.message);}});
$('annotation-form').addEventListener('submit',async event=>{event.preventDefault();if(!state.rollout)return;const button=$('save-annotation'),session=state.session;const id=state.rollout.summary.episodeId;const text=$('annotation-text').value.trim();if(!text)return;button.disabled=true;try{const payload={kind:$('annotation-kind').value,text,...($('annotation-player').value?{playerId:$('annotation-player').value}:{})};await request(`/rollouts/${encodeURIComponent(id)}/annotations`,payload);if(session!==state.session)return;if(state.rollout?.summary.episodeId===id){$('annotation-text').value='';await refreshDetail();}if(session===state.session)message('审阅记录已保存到服务器。');}catch(error){if(session===state.session)message(error.message,true);}finally{button.disabled=!isDone(state.rollout?.summary);}});
$('api-address').value=apiUrl;$('api-address').readOnly=!transport.desktop;$('remember-label').hidden=!transport.desktop;$('play-link').hidden=transport.desktop;
if(transport.desktop)setText('credential-storage','只保存系统加密的登录会话，不保存密码。退出会清除本机保存并撤销当前密码会话。');
setLoginMode('password');
updateConnectionLabel();
const initialSession=state.session;
if(transport.desktop||transport.legacyLocal)setConnectionStatus('checking','检查已保存连接…');
transport.getConnection().then(async info=>{
 if(initialSession!==state.session)return;apiUrl=info.apiUrl;$('api-address').value=apiUrl;state.connection.attemptUrl=apiUrl;updateConnectionLabel();
 if(info.connected)await activateConnection(info,initialSession);
 else if(info.connectionError){const error=info.connectionError;setConnectionStatus(Number(error?.status)===401&&error?.code!=='PROXY_AUTH_REQUIRED'?'expired':'failed',connectionErrorText(error),{lastCheckedAt:new Date().toISOString()});message(`恢复连接失败：${connectionErrorText(error)}`,true);}
 else {setConnectionStatus('idle','输入个人访问凭证后连接。',{lastCheckedAt:null});if(!transport.desktop)await loadGames();}
}).catch(error=>{if(initialSession===state.session){setConnectionStatus('failed',`恢复连接失败：${connectionErrorText(error)}`,{lastCheckedAt:new Date().toISOString()});message(connectionErrorText(error),true);}});
setInterval(()=>{if(state.token&&!state.passwordBusy&&!state.connectionCheck&&!['connecting','checking'].includes(state.connection.phase))void checkConnection();},20000);
setInterval(async()=>{if(!state.token||state.passwordBusy||!$('auto-refresh').checked||state.loading||state.playing||document.hidden)return;state.loading=true;const session=state.session;try{await loadList();if(state.rollout&&!isDone(state.rollout.summary))await refreshDetail();if(state.rollout&&state.artifacts.some(a=>a.status!=='complete'))await loadArtifacts();}catch(error){if(session===state.session&&error.name!=='AbortError')message(`自动刷新失败：${error.message}`,true);}finally{state.loading=false;}},5000);
window.addEventListener('beforeunload',()=>{clearSensitiveFields();stopPlayback();clearArtifacts();clearModelMessages();});


