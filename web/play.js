const $=id=>document.getElementById(id);let games=[],latest=null,exampleActions=[],prepared=null;
const show=(id,value)=>$(id).textContent=typeof value==='string'?value:JSON.stringify(value,null,2);
function options(id,items){$(id).replaceChildren(...items.map(([value,label])=>{const opt=document.createElement('option');opt.value=value;opt.textContent=label;return opt;}));}
const transport=window.coopTransport;const apiUrl=transport.defaultApi;
async function request(path,token,body,key){if(transport.desktop)throw Error('桌面客户端请回到审计台创建对局；玩家通过各自的 API 座位凭证行动。');const response=await transport.request('/api/v1'+path,{method:body?'POST':'GET',...(transport.legacyLocal&&path==='/episodes'&&token==='@local-human'?{}:{seatToken:token??''}),...(body?{body}:{}),...(key?{idempotencyKey:key}:{})});const data=await response.json();if(!response.ok)throw Error(JSON.stringify(data));return data;}
function chooseGame(){const game=games.find(g=>g.id===$('game').value);options('scenario',game.scenarios.map(s=>[s.id,s.name]));options('players',game.players.map(p=>[p,`${p} 人`]));show('rules',game);}
function render(obs){latest=obs;show('status',`${obs.playerId} · ${obs.status}${obs.outcome?' · '+obs.outcome.reason:''}`);show('view',obs.view);show('updates',obs.updates??[]);show('legal',obs.legalActions);exampleActions=obs.legalActions.flatMap(a=>a.examples?.length?a.examples:[{type:a.type}]);options('examples',exampleActions.map((a,i)=>[i,JSON.stringify(a)]));if(exampleActions.length)$('action').value=JSON.stringify(exampleActions[0],null,2);}
function handle(id,fn){$(id).onclick=async()=>{$(id).disabled=true;try{await fn();}catch(error){show('result',error.message);}finally{$(id).disabled=false;}};}
$('game').onchange=chooseGame;$('examples').onchange=()=>{$('action').value=JSON.stringify(exampleActions[Number($('examples').value)],null,2);};
handle('create',async()=>{const data=await request('/episodes',$('admin').value,{gameId:$('game').value,scenarioId:$('scenario').value,playerCount:Number($('players').value)});show('seats',data.seats);$('episode').value=data.episodeId;$('token').value=data.seats[0].token;latest=null;prepared=null;show('result','对局已创建。把每个玩家的凭证分别交给该玩家。');});
for(const id of ['episode','token'])$(id).oninput=()=>{latest=null;prepared=null;};
handle('observe',async()=>render(await request(`/episodes/${encodeURIComponent($('episode').value)}/observation?after=${latest?.updateCursor??0}`,$('token').value)));
async function submit(){const sent=prepared;const data=await request(sent.path,sent.token,sent.command,sent.key);if(data.observation && (!latest || latest.decisionToken===sent.command.decisionToken))render(data.observation);show('result',data.accepted?'操作已接收；其他玩家可拉取自己的观察。':data);}
handle('submit',async()=>{if(!latest)throw Error('请先拉取本玩家的观察。');prepared={path:`/episodes/${encodeURIComponent($('episode').value)}/actions`,token:$('token').value,key:crypto.randomUUID(),command:{observationId:latest.observationId,decisionToken:latest.decisionToken,action:JSON.parse($('action').value)}};await submit();});
handle('retry',async()=>{if(!prepared)throw Error('没有可重试的请求。');await submit();});
async function loadGames(){const data=await request('/games');games=data.games;options('game',games.map(g=>[g.id,g.name]));chooseGame();}
if(!transport.desktop&&!transport.legacyLocal)loadGames().catch(error=>show('result',error.message));
show('connection',`本机 Agent API：${apiUrl}`);
async function copyText(text){await transport.copyText(text);}
handle('copy-api',async()=>{await copyText(apiUrl);show('result','已复制本机 API 地址。');});
handle('copy-player',async()=>{
  if(!$('episode').value||!$('token').value)throw Error('请先创建对局或填写当前玩家凭证。');
  await copyText(JSON.stringify({baseUrl:apiUrl,episodeId:$('episode').value,seatToken:$('token').value},null,2));
  show('result','已复制当前玩家配置，可以交给该玩家的 agent。');
});
if(transport.desktop){for(const id of ['create','observe','submit','retry','copy-player'])$(id).disabled=true;show('connection','桌面客户端 · 云端 API');show('data-location','轨迹由后端服务器保存。');show('result','请返回审计台选择游戏和创建对局。把独立的座位配置交给各个 Agent；桌面客户端只使用人工审阅权限。');}

if(transport.legacyLocal)transport.getConnection().then(async info=>{if(info.connected){await loadGames();$('admin').value='@local-human';show('data-location','本机数据目录由桌面应用管理。');show('result','本机环境已就绪。创建后分别复制各玩家的连接配置。');}}).catch(error=>show('result',error.message));
