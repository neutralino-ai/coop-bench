// Synthetic UI fixtures only. No real model reasoning, private credentials, or
// game service is read. Run with Electron; the fixture server binds 127.0.0.1.
const {app,BrowserWindow}=require('electron');
const {createServer}=require('node:http');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {join,resolve}=require('node:path');
const root=resolve(__dirname,'..'),output=join(root,'artifacts','model-messages-ui-smoke');
mkdirSync(output,{recursive:true});app.setPath('userData',join(output,'profile'));
const at='2026-09-17T09:00:00.000Z',players=['p1','p2','p3'],requests=[];
const retention={policy:'indefinite',automaticDeletion:false,onCapacity:'reject-new-writes'};
const summary={episodeId:'synthetic-fixture',gameId:'take-time',gameName:'Synthetic model-message UI fixture',scenarioId:'official-clock-1-1',playerCount:3,status:'completed',actionCount:0,eventCount:1,createdAt:at,updatedAt:at,coverage:'recorded'};
const rollout={summary,players,metadata:{rulesSummary:['Synthetic UI fixture; not an actual game or model trace.']},annotations:[{id:'review-fixture',kind:'reflection',playerId:'p1',source:'seat',createdAt:at,text:'SYNTHETIC POST-GAME REFLECTION ONLY'}],frames:[{seq:1,kind:'created',at,views:{}}]};
const messages=Array.from({length:27},(_,sequence)=>({sequence,messageId:`synthetic-message-${sequence}`,kind:sequence%2?'model-output':'model-input',clientAt:at,serverReceivedAt:at,observationId:`synthetic-observation-${sequence}`,requestId:`synthetic-action-${sequence}`,provider:'synthetic fixture provider',model:'synthetic fixture model',reasoningAvailability:'not-provided',message:{role:sequence%2?'assistant':'user',content:`SYNTHETIC UI MESSAGE ${sequence}; this is not an actual model transcript.`},provenance:'client-supplied-unverified'}));
messages[0]={...messages[0],reasoningAvailability:'provided',message:{role:'assistant',content:'SYNTHETIC OUTPUT',reasoning_content:'SYNTHETIC REASONING FIELD: prefer the legal move shown in this test fixture. This text is authored only for UI testing.'}};
messages[1]={...messages[1],tokenUsage:{reasoning_tokens:42,total_tokens:55},message:{role:'assistant',content:'SYNTHETIC TOKEN-COUNT-ONLY MESSAGE; no reasoning text is present.'}};
messages[2]={...messages[2],reasoningAvailability:'summary-only',message:{role:'assistant',content:[{type:'thinking',thinking:'SYNTHETIC THINKING BLOCK <img src=x onerror="window.syntheticMessageXss=true">'},{type:'text',text:'SYNTHETIC VISIBLE ANSWER'}]}};
messages[3]={...messages[3],reasoningAvailability:'redacted',message:{role:'assistant',reasoning:{summary:'SYNTHETIC STRUCTURED REASONING SUMMARY; not hidden internal thoughts.'},content:'SYNTHETIC SUMMARY RESPONSE'}};
messages[4]={...messages[4],message:{role:'model-request',capture:{schema:'coop-agent-capture/v1',logicalId:'synthetic-fragments',event:'model-request',encoding:'base64',fragment:true,index:0,count:2,totalBytes:80,sha256:'0'.repeat(64)},dataBase64:'U1lOVEhFVElDIEZSQ udFTUVOVA=='}};
messages[5]={...messages[5],reasoningAvailability:'provided',message:{role:'assistant',capture:{schema:'coop-agent-capture/v1',logicalId:'synthetic-response',event:'model-response',encoding:'json'},raw:{choices:[{message:{role:'assistant',reasoning_content:'SYNTHETIC RAW CHOICES REASONING FIELD',content:'SYNTHETIC FINAL'}}]}}};
messages[6]={...messages[6],reasoningAvailability:'summary-only',message:{role:'assistant',raw:{output:[{type:'reasoning',summary:[{type:'summary_text',text:'SYNTHETIC RESPONSE SUMMARY ONLY'}],encrypted_content:'SYNTHETIC OPAQUE DATA; not real encrypted reasoning'}],usage:{output_tokens_details:{reasoning_tokens:12}}}}};
const completion={episodeId:summary.episodeId,playerId:'p1',scope:'synthetic UI fixture only',completeness:'partial',reasoningAvailability:'summary-only',unavailable:['provider internal reasoning unavailable in this synthetic fixture','raw token IDs not supplied'],sealedAt:at,lastSequence:26,provenance:'client-supplied-unverified'};
let delayNext=false,limitNext=false,win;
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));}
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname;
 if(['/','/app.js','/style.css'].includes(path)){res.writeHead(200,{'Content-Type':path==='/'?'text/html':path.endsWith('.js')?'text/javascript':'text/css','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(readFileSync(join(root,'web',path==='/'?'index.html':path.slice(1))));return;}
 if(path==='/api/v1/games'){json(res,{games:[{id:'take-time',name:'Take Time'}]});return;}
 if(req.headers.authorization!=='Bearer synthetic-ui-only'){json(res,{error:{code:'UNAUTHORIZED'}},401);return;}
 if(path==='/api/v1/identity'){json(res,{id:'synthetic-auditor',role:'auditor',retention});return;}
 if(path==='/api/v1/rollouts'){json(res,{items:[summary],total:1});return;}
 if(path==='/api/v1/rollouts/synthetic-fixture'){json(res,rollout);return;}
 if(path==='/api/v1/rollouts/synthetic-fixture/artifacts'){json(res,{artifacts:[{id:'tool-only',name:'synthetic-api-tools.jsonl',playerId:'p1',kind:'agent-trace',status:'complete',mediaType:'application/x-ndjson',byteLength:32,sha256:'0'.repeat(64),createdAt:at,reasoningAvailability:'summary-only'}],retention});return;}
 if(path==='/api/v1/rollouts/synthetic-fixture/messages'){
  const playerId=url.searchParams.get('playerId'),after=Number(url.searchParams.get('after')),limit=Number(url.searchParams.get('limit'));requests.push({playerId,after,limit});
  if(limitNext){limitNext=false;json(res,{error:{code:'RATE_LIMITED',message:'Synthetic temporary rate limit'}},429);return;}
  const page=playerId==='p1'?messages.filter(message=>message.sequence>after).slice(0,limit):[];
  const reply=()=>json(res,{episodeId:summary.episodeId,playerId,messages:page,nextAfter:page.at(-1)?.sequence??after,hasMore:playerId==='p1'&&(page.at(-1)?.sequence??after)<26,completion:playerId==='p1'?completion:null,retention});
  if(delayNext){delayNext=false;setTimeout(reply,600);}else reply();return;
 }
 json(res,{error:{code:'NOT_FOUND'}},404);
});
async function browserChecks(){
 const $=id=>document.getElementById(id),checks=[];
 const assert=(condition,label)=>{if(!condition)throw Error(label);checks.push(label);};
 const wait=async(fn,label)=>{const end=Date.now()+10000;while(!fn()){if(Date.now()>end)throw Error(label+': '+$('message').textContent);await new Promise(resolve=>setTimeout(resolve,25));}};
 $('admin-token').value='synthetic-ui-only';$('login-form').querySelector('button[type="submit"]').click();
 await wait(()=>$('model-messages').querySelectorAll('.model-message').length===25,'load first message page');
 assert($('model-message-player').options.length===3,'message reader offers all three players');
 assert($('model-messages-panel').textContent.includes('独立于上方回放进度'),'whole-episode messages explicitly separated from selected replay frame');
 assert($('model-messages').querySelectorAll('pre').length>0&&[...$('model-messages').querySelectorAll('pre')].every(pre=>!pre.textContent),'raw JSON is lazy and initially absent from DOM');
 assert($('model-message-status').textContent.includes('partial')&&$('model-message-status').textContent.includes('未获取内容'),'partial capture and unavailable fields conspicuous');
 assert($('model-message-status').textContent.includes('仅摘要'),'summary-only is not called complete hidden reasoning');
 const first=$('model-messages').querySelector('[data-message-sequence="0"]');
 assert(first.textContent.includes('synthetic-observation-0')&&first.textContent.includes('synthetic-action-0'),'observation and action correlation IDs displayed');
 assert(first.textContent.includes('服务器收到')&&first.textContent.includes('客户端时间'),'server and client time sources distinguished');
 first.querySelector('details').open=true;
 await wait(()=>first.querySelector('pre').textContent.includes('SYNTHETIC REASONING FIELD'),'show original reasoning field');
 assert(first.textContent.includes('未经服务器核验'),'unverified client provenance displayed');
 const tokenOnly=$('model-messages').querySelector('[data-message-sequence="1"]');
 assert(tokenOnly.textContent.includes('42')&&tokenOnly.textContent.includes('未上传 reasoning / thinking 字段原文'),'reasoning token count is not mistaken for reasoning text');
 assert(tokenOnly.querySelectorAll('details').length===1,'token-only message has no fabricated reasoning block');
 const thinking=$('model-messages').querySelector('[data-message-sequence="2"]');thinking.querySelector('details').open=true;
 await wait(()=>thinking.querySelector('pre').textContent.includes('<img'),'render synthetic thinking block');
 assert(!thinking.querySelector('img')&&!window.syntheticMessageXss,'synthetic thinking markup remains safe text');
 assert(thinking.textContent.includes('仅摘要'),'summary declaration retained even when field name says thinking');
 const structured=$('model-messages').querySelector('[data-message-sequence="3"]');structured.querySelector('details').open=true;
 await wait(()=>structured.querySelector('pre').textContent.includes('SYNTHETIC STRUCTURED'),'render structured reasoning field');checks.push('structured reasoning payload retained exactly');
 const fragmented=$('model-messages').querySelector('[data-message-sequence="4"]');assert(fragmented.textContent.includes('分片：1 / 2')&&fragmented.textContent.includes('单片不代表完整'),'base64 fragment not presented as full readable model output');
 const rawChoices=$('model-messages').querySelector('[data-message-sequence="5"]');rawChoices.querySelector('details').open=true;
 await wait(()=>rawChoices.querySelector('pre').textContent.includes('SYNTHETIC RAW CHOICES'),'recognize raw choices reasoning field');checks.push('actual field path retained within raw provider envelope');
 const opaque=$('model-messages').querySelector('[data-message-sequence="6"]');assert(opaque.textContent.includes('summary 仅为摘要')&&opaque.textContent.includes('不透明的加密内容'),'summary and encrypted payload not mislabeled full reasoning');
 assert(!$('model-messages').textContent.includes('SYNTHETIC POST-GAME REFLECTION')&&$('annotations').textContent.includes('SYNTHETIC POST-GAME REFLECTION'),'post-game reflection is separate from in-game model messages');
 first.querySelector('details').open=false;
 await wait(()=>!first.querySelector('pre').textContent,'release collapsed long text');checks.push('collapsed raw text removed from DOM');
 assert($('previous-model-messages').disabled&&!$('next-model-messages').disabled,'first-page navigation state');
 $('next-model-messages').click();
 await wait(()=>$('model-messages').querySelectorAll('.model-message').length===2,'load second page');
 assert($('model-messages').querySelector('[data-message-sequence="25"]')&&$('next-model-messages').disabled,'cursor pagination reaches last page without accumulating old DOM');
 $('previous-model-messages').click();
 await wait(()=>$('model-messages').querySelectorAll('.model-message').length===25,'return first page');
 assert($('previous-model-messages').disabled,'previous control disabled again on first page');
 $('model-message-player').value='p2';$('model-message-player').dispatchEvent(new Event('change'));
 await wait(()=>$('model-messages').textContent.includes('本局尚无完整模型消息上传'),'empty second-player stream');
 assert($('model-messages').textContent.includes('下方工具附件不是完整模型输入输出'),'empty stream does not claim tool-only artifact is complete messages');
 assert(!$('model-messages').textContent.includes('SYNTHETIC REASONING FIELD'),'changing player clears previous player messages');
 $('model-message-player').value='p1';$('model-message-player').dispatchEvent(new Event('change'));
 await wait(()=>$('model-messages').querySelectorAll('.model-message').length===25,'restore populated stream');
 $('model-messages').querySelector('details').open=true;$('model-messages-panel').scrollIntoView({block:'start'});
 await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 assert(document.documentElement.scrollWidth<=innerWidth+1,'model message desktop layout has no horizontal overflow');
 return checks;
}
app.whenReady().then(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 win=new BrowserWindow({width:1500,height:1150,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.session.setPermissionRequestHandler((_a,_b,done)=>done(false));
 await win.loadURL(`http://127.0.0.1:${server.address().port}`);
 const checks=await win.webContents.executeJavaScript('('+browserChecks.toString()+')()',true);
 if(requests.some(request=>request.limit!==25))throw Error('Unexpected page size');checks.push('every request bounded to 25 messages');
 if(!requests.some(request=>request.after===24))throw Error('Next page did not use server cursor');checks.push('next page uses server sequence cursor');
 writeFileSync(join(output,'model-messages.png'),(await win.webContents.capturePage()).toPNG());
 limitNext=true;
 await win.webContents.executeJavaScript("document.getElementById('refresh-model-messages').click();new Promise(r=>setTimeout(r,150))");
 const limitSafe=await win.webContents.executeJavaScript("document.getElementById('model-messages').textContent.includes('读取频率')&&document.querySelectorAll('.model-message').length===25");
 if(!limitSafe)throw Error('Rate limit did not preserve loaded page');checks.push('rate limit gives retry guidance and preserves loaded messages');
 delayNext=true;
 await win.webContents.executeJavaScript("document.getElementById('refresh-model-messages').click();document.getElementById('disconnect').click();new Promise(r=>setTimeout(r,850))");
 const cleared=await win.webContents.executeJavaScript("document.getElementById('detail').hidden&&!document.getElementById('model-messages').textContent&&!document.getElementById('model-message-status').textContent&&!document.getElementById('model-message-player').options.length");
 if(!cleared)throw Error('Late response restored model messages after logout');checks.push('logout clears all message DOM and drops delayed response');
 win.setContentSize(710,950);await win.webContents.executeJavaScript("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
 const narrow=await win.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth+1');if(!narrow)throw Error('Narrow page overflow');checks.push('narrow page has no horizontal overflow');
 writeFileSync(join(output,'result.json'),JSON.stringify({ok:true,at:new Date().toISOString(),scope:'synthetic UI fixture; no actual model reasoning or credentials accessed',checks,requests},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,output}));server.close();app.quit();
}).catch(error=>{writeFileSync(join(output,'result.json'),JSON.stringify({ok:false,at:new Date().toISOString(),error:String(error),stack:error.stack},null,2));console.error(error);server.close();app.exit(1);});
app.on('window-all-closed',()=>app.quit());
