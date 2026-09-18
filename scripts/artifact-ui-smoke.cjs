// Isolated UI fixtures only: does not authenticate to or modify a real service.
// Run with node_modules/electron/dist/electron.exe scripts/artifact-ui-smoke.cjs.
const {app,BrowserWindow}=require('electron');
const {createServer}=require('node:http');
const {createHash}=require('node:crypto');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {resolve,join}=require('node:path');
const root=resolve(__dirname,'..'),output=join(root,'artifacts','artifact-ui-smoke');
mkdirSync(output,{recursive:true});app.setPath('userData',join(output,'profile'));
const at='2026-09-17T08:00:00.000Z',players=['p1','p2','p3'];
const bytes=Buffer.from('{"role":"assistant","content":"fixture decision summary; no hidden reasoning"}\n');
const artifact={id:'fixture-file',episodeId:'fixture',playerId:'p1',name:'agent-trace.jsonl',mediaType:'application/x-ndjson',kind:'agent-trace',byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),status:'complete',createdAt:at,completedAt:at,chunkSize:32768,chunkCount:1,receivedChunks:[0],missingChunks:[],provenance:'client-supplied-unverified',model:'fixture-model',provider:'<img src=x onerror="window.artifactXss=true">',reasoningAvailability:'summary-only',tokenCounts:{input:20,output:12,reasoning:0}};
const retention={policy:'indefinite',automaticDeletion:false,onCapacity:'reject-new-writes'};
const backs={p1:{hand:['solar','lunar','solar','lunar'],reserve:[]},p2:{hand:['lunar','lunar','solar','lunar'],reserve:[]},p3:{hand:['solar','solar','solar','lunar'],reserve:[]}};
function views(phase,looked=[]){return Object.fromEntries(players.map(player=>[player,{observationId:'fixture-observation',view:{phase,playerId:player,activePlayerIds:players,hand:looked.includes(player)?[{color:'solar',value:2},{color:'lunar',value:4}]:null,lookedPlayerIds:looked,cardBacks:backs,placements:[],ownPlacements:[],faceUpRemaining:3}}]));}
const summary={episodeId:'fixture',gameId:'take-time',gameName:'Take Time · 前端验证样例',scenarioId:'clock-1-1',playerCount:3,status:'completed',actionCount:2,eventCount:4,createdAt:at,updatedAt:at,coverage:'recorded',outcome:{kind:'loss',success:false}};
const rollout={summary,players,metadata:{name:'Take Time',scenarios:[{id:'clock-1-1',name:'Clock 1-1 · UI fixture'}],rulesSummary:['此样例仅测试前端，不代表真实对局或能力评估。']},annotations:[],frames:[{seq:0,kind:'created',at,views:views('discussion')},{seq:1,kind:'accepted',playerId:'p1',action:{type:'speak',text:'先按公开的太阳/月亮牌背数量讨论分工。'},at,views:views('discussion')},{seq:2,kind:'accepted',playerId:'p1',action:{type:'look_hand'},at,views:views('playing',['p1'])},{seq:3,kind:'system',at,views:views('finished',players)}]};
let pendingArtifactList=false,downloadRequests=0,downloadEvents=0,server,win;
function json(res,value){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
server=createServer((req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 if(['/','/app.js','/style.css'].includes(path)){res.writeHead(200,{'Content-Type':path==='/'?'text/html':path.endsWith('.js')?'text/javascript':'text/css','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(readFileSync(join(root,'web',path==='/'?'index.html':path.slice(1))));return;}
 if(path==='/api/v1/games'){json(res,{games:[{id:'take-time',name:'Take Time'}]});return;}
 if(req.headers.authorization!=='Bearer fixture-ui-only'){res.writeHead(401,{'Content-Type':'application/json'});res.end('{"error":{"code":"UNAUTHORIZED"}}');return;}
 if(path==='/api/v1/identity'){json(res,{id:'fixture-human',role:'operator',retention});return;}
 if(path==='/api/v1/rollouts'){json(res,{items:[summary],total:1});return;}
 if(path==='/api/v1/rollouts/fixture'){json(res,rollout);return;}
 if(path==='/api/v1/rollouts/fixture/artifacts'){
  const reply=()=>json(res,{artifacts:[artifact,{...artifact,id:'fixture-pending',playerId:'p2',name:'p2-incomplete.jsonl',status:'uploading',receivedChunks:[],missingChunks:[0],completedAt:undefined}],retention});
  if(pendingArtifactList)setTimeout(reply,700);else reply();return;
 }
 if(path==='/api/v1/rollouts/fixture/artifacts/fixture-file/content'){downloadRequests++;res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="agent-trace.jsonl"'});res.end(bytes);return;}
 res.writeHead(404);res.end();
});
async function browserChecks(){
 const $=id=>document.getElementById(id),checks=[];
 const assert=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
 const wait=async(fn,label)=>{const end=Date.now()+10000;while(!fn()){if(Date.now()>end)throw Error(label+': '+$('message').textContent);await new Promise(resolve=>setTimeout(resolve,30));}};
 const step=index=>{$('timeline').value=String(index);$('timeline').dispatchEvent(new Event('input',{bubbles:true}));};
 assert($('credential-help').textContent.includes('组织者')&&$('credential-help').textContent.includes('座位凭证'),'login explains credential source and separates agent credentials');
 $('admin-token').value='fixture-ui-only';$('login-form').querySelector('button[type="submit"]').click();
 await wait(()=>$('artifacts').querySelectorAll('.artifact-card').length===2,'load rollout and artifact manifest');
 assert($('identity-permissions').textContent.includes('全组'),'identity states team-wide operator permissions');
 assert(!$('communication-panel').hidden&&$('discussion').textContent.includes('太阳/月亮'),'communication visible in rollout');
 assert($('discussion-context').textContent.includes('API'),'communication API explicitly explained');
 step(0);
 assert($('board').querySelectorAll('.card-back-player').length===3,'initial public card backs shown for all players');
 assert($('board').querySelector('[data-player="p2"]').textContent.includes('太阳 1 张')&&$('board').querySelector('[data-player="p2"]').textContent.includes('月亮 3 张'),'legacy frame backs counted without future backfill');
 assert([...$('board').querySelectorAll('.game-card')].every(card=>card.dataset.known==='false'),'initial hand values remain hidden');
 assert($('discussion').textContent.includes('后续消息'),'initial frame does not display future discussion');
 step(1);assert($('discussion').querySelectorAll('.speech').length===1,'speak text appears at the recorded event');
 step(2);assert($('board').querySelector('[data-player="p1"]').textContent.includes('禁言'),'looked player marked silent');
 assert($('artifacts').textContent.includes('仅决策摘要')&&$('artifacts').textContent.includes('未经核验'),'reasoning metadata distinguished from verified hidden reasoning');
 assert(!$('artifacts').querySelector('img')&&!window.artifactXss,'untrusted artifact metadata rendered as text');
 assert(document.querySelector('[data-download-artifact="fixture-pending"]').disabled,'incomplete upload download disabled');
 assert($('retention-policy').textContent.includes('不自动删除')&&$('retention-policy').textContent.includes('拒绝新增写入'),'retention and capacity behavior shown');
 document.querySelector('[data-download-artifact="fixture-file"]').click();
 await wait(()=>$('message').textContent.includes('SHA-256 校验通过'),'download original bytes and validate digest');
 assert($('message').textContent.includes('校验通过'),'explicit download validates byte count and digest');
 assert(typeof window.require==='undefined'&&typeof window.process==='undefined','renderer Node access disabled');
 step(1);$('artifacts').scrollIntoView({block:'center'});
 await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 assert(document.documentElement.scrollWidth<=innerWidth+1,'desktop page has no horizontal overflow');
 return checks;
}
app.whenReady().then(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 win=new BrowserWindow({width:1600,height:1200,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.session.setPermissionRequestHandler((_a,_b,done)=>done(false));
 win.webContents.session.on('will-download',event=>{downloadEvents++;event.preventDefault();});
 await win.loadURL(`http://127.0.0.1:${server.address().port}`);
 const checks=await win.webContents.executeJavaScript('('+browserChecks.toString()+')()',true);
 if(downloadRequests!==1||downloadEvents!==1)throw Error('Expected only one explicit content download');checks.push('no automatic artifact content fetch');
 writeFileSync(join(output,'artifacts.png'),(await win.webContents.capturePage()).toPNG());
 await win.webContents.executeJavaScript("document.getElementById('timeline').value='0';document.getElementById('timeline').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.board-panel').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
 writeFileSync(join(output,'initial-discussion.png'),(await win.webContents.capturePage()).toPNG());
 // Simulate an older episode that skipped speaking. This is a renderer fixture only.
 rollout.frames[1].action={type:'look_hand'};
 await win.webContents.executeJavaScript("document.getElementById('refresh').click();new Promise(r=>setTimeout(r,200))");
 const noSpeech=await win.webContents.executeJavaScript("document.getElementById('discussion').textContent.includes('这局没有已记录的公开沟通动作')");
 if(!noSpeech)throw Error('Empty completed communication misleading');checks.push('silent historical demo explicitly describes missing speak events');
 pendingArtifactList=true;
 await win.webContents.executeJavaScript("document.getElementById('refresh-artifacts').click();document.getElementById('disconnect').click();new Promise(r=>setTimeout(r,1000))");
 const cleared=await win.webContents.executeJavaScript("document.getElementById('detail').hidden&&!document.getElementById('artifacts').textContent&&!document.getElementById('discussion').textContent&&!document.getElementById('board').textContent&&!document.getElementById('identity-permissions').textContent&&!document.getElementById('admin-token').value");
 if(!cleared)throw Error('Stale artifact request restored private data after logout');checks.push('logout clears private DOM and rejects late manifest response');
 win.setContentSize(720,1000);await win.webContents.executeJavaScript("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
 const narrow=await win.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth+1');if(!narrow)throw Error('Mobile login overflows horizontally');checks.push('narrow login layout has no horizontal overflow');
 const report={ok:true,at:new Date().toISOString(),scope:'isolated renderer fixture only; no real episodes modified',checks,downloadRequests,downloadEvents};writeFileSync(join(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,checks:checks.length,output}));server.close();app.quit();
}).catch(error=>{writeFileSync(join(output,'result.json'),JSON.stringify({ok:false,at:new Date().toISOString(),error:String(error),stack:error.stack},null,2));console.error(error);server.close();app.exit(1);});
app.on('window-all-closed',()=>app.quit());
