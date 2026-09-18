// Read-only live acceptance using the actual packaged renderer, preload and
// RemoteSession. Run this entry with Electron, never with plain Node.
import { app, BrowserWindow, ipcMain, protocol, session } from 'electron';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=join(root,'artifacts/cloud-api34935-desktop-live-check');
const profile=join(output,'profile');
const archive=join(root,'release/win-unpacked/resources/app.asar');
const apiUrl='https://coop.neutrinophysics.cn:34935/api/v1';
const episodeId='5286719d-dcf7-48d1-81e8-2c1d2ba5c639';
mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setName('Coop Bench Isolated Live Verification');
protocol.registerSchemesAsPrivileged([{scheme:'coop',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);

let ownerToken='',remote,window,apiSession,publicConnectionError,finished=false;
const checks=[],requests=[],rendererErrors=[];
const report={schema:'coop-live-desktop-check/v1',startedAt:new Date().toISOString(),apiUrl,episodeId,
 packagedSources:{archive:'release/win-unpacked/resources/app.asar',remoteSession:'desktop/remote-session.mjs',preload:'desktop/preload.cjs',web:'runtime/coop-bench/web'},
 readOnly:true,isolatedProfile:'artifacts/cloud-api34935-desktop-live-check/profile',windowShown:false,checks,requests,rendererErrors};
function check(value,name){assert.ok(value,name);checks.push(name);}
function safeError(error){return publicConnectionError?publicConnectionError(error):{code:'VERIFICATION_ERROR',message:'无法初始化隔离客户端验证。'};}
const trusted=url=>{try{const value=new URL(url);return value.protocol==='coop:'&&value.host==='app'&&!value.username&&!value.password&&['/','/index.html'].includes(value.pathname);}catch{return false;}};
function validateSender(event){if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!trusted(event.senderFrame.url))throw Error('此验证仅允许隔离客户端主窗口调用。');}
const evaluate=(fn,...args)=>window.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`,true);
async function waitFor(fn,message,timeout=60000){const deadline=Date.now()+timeout;while(!await fn()){if(Date.now()>deadline)throw Error(message);await new Promise(resolve=>setTimeout(resolve,100));}}
async function cleanup(){
 if(finished)return;finished=true;
 try{remote?.invalidate();if(remote){remote.saved=null;remote.restorePromise=null;}ownerToken='';report.credentialStateCleared=!remote?.token&&!ownerToken&&!remote?.saved;
  if(window&&!window.isDestroyed())window.destroy();
  if(apiSession){await apiSession.clearCache();await apiSession.clearStorageData();if(typeof apiSession.clearAuthCache==='function')await apiSession.clearAuthCache();}
 }catch{report.cleanupWarning='Some isolated session cleanup could not be confirmed.';}
 report.finishedAt=new Date().toISOString();writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));
}
async function main(){
 check(existsSync(archive),'Packaged app.asar exists');
 report.packagedSources.archiveSha256=createHash('sha256').update(createRequire(import.meta.url)('original-fs').readFileSync(archive)).digest('hex');
 const packagedModule=await import(pathToFileURL(join(archive,'desktop/remote-session.mjs')).href);
 const {RemoteSession}=packagedModule;publicConnectionError=packagedModule.publicConnectionError;
 report.version=JSON.parse(readFileSync(join(archive,'package.json'),'utf8')).version;
 check(typeof RemoteSession==='function','RemoteSession imported directly from packaged app.asar');
 ownerToken=readFileSync(join(root,'artifacts/cloud-private/owner.txt'),'utf8').trim();
 check(ownerToken.length>=24&&ownerToken.length<=256,'Existing owner credential loaded only into main-process memory');
 await app.whenReady();
 apiSession=session.fromPartition('coop-readonly-live-verification');
 remote=new RemoteSession({store:{load:()=>({apiUrl,token:ownerToken}),save:()=>{}},fetcher:async(url,options)=>{
  const target=new URL(url),expected=new URL(apiUrl);
  assert.equal(options.method,'GET','Live verifier prohibits every non-GET network request');
  assert.equal(target.origin,expected.origin,'Live verifier restricts the API origin');
  assert.ok(target.pathname.startsWith('/api/v1/'),'Live verifier restricts the API path');
  const item={method:'GET',path:target.pathname+target.search,startedAt:new Date().toISOString()};requests.push(item);
  try{const response=await apiSession.fetch(url,{...options,cache:'no-store'});item.status=response.status;return response;}
  catch(error){item.failed=true;throw error;}
 }});
 report.networkImplementation='Electron session.fetch / Chromium network stack, with packaged RemoteSession validation';
 const assets={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/transport.js':'transport.js','/style.css':'style.css'};
 const csp="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
 protocol.handle('coop',request=>{
  const url=new URL(request.url),file=assets[url.pathname];
  if(request.method!=='GET'||url.host!=='app'||url.username||url.password||url.search||!file)return new Response('Not found',{status:404});
  const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
  return new Response(readFileSync(join(archive,'runtime/coop-bench/web',file)),{headers:{'Content-Type':`${type}; charset=utf-8`,'Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});
 });
 const deny=()=>{throw Error('此只读验证禁止该操作。');};
 const handlers={'get-connection':()=>remote.restore(),'get-account':()=>remote.getAccount(),login:deny,'set-password':deny,connect:deny,disconnect:()=>remote.disconnect(),request:input=>{assert.equal(input?.method,'GET','Live IPC prohibits mutation');return remote.request(input);},'cancel-request':id=>{if(typeof id==='string')remote.cancel(id);},'copy-text':deny};
 for(const [name,handler]of Object.entries(handlers))ipcMain.handle(`coop:${name}`,async(event,input)=>{validateSender(event);try{return {ok:true,value:await handler(input)};}catch(error){return {ok:false,error:safeError(error)};}});
 window=new BrowserWindow({width:1500,height:1120,minWidth:980,minHeight:680,show:false,autoHideMenuBar:true,title:'Coop Bench · Isolated Read-only Verification',webPreferences:{preload:join(archive,'desktop/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(!trusted(url))event.preventDefault();});
 window.webContents.on('will-redirect',event=>event.preventDefault());
 window.webContents.on('will-attach-webview',event=>event.preventDefault());
 window.webContents.on('render-process-gone',(_event,details)=>rendererErrors.push({kind:'render-process-gone',reason:details.reason}));
 window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 window.webContents.session.setPermissionCheckHandler(()=>false);
 window.webContents.session.on('will-download',event=>event.preventDefault());
 app.on('login',(event,_contents,_details,_auth,callback)=>{event.preventDefault();callback();});
 await window.loadURL(`coop://app/#episode=${episodeId}`);
 await waitFor(()=>evaluate(()=>Boolean(window.coopTransport)),'Packaged UI initialization timed out.');
 check(await evaluate(()=>typeof window.require==='undefined'&&typeof window.process==='undefined'),'Packaged renderer has no Node access');
 await waitFor(()=>evaluate(()=>document.getElementById('connection-status').dataset.state==='connected'),'Live API identity validation did not reach the green connected state.');
 const connection=await evaluate(()=>window.coopDesktop.getConnection());
 check(connection.connected&&connection.identity?.id==='owner'&&connection.identity?.role==='operator','Live owner/operator identity verified through packaged preload');
 check(!Object.hasOwn(connection,'token')&&!Object.hasOwn(connection,'adminToken'),'Renderer connection descriptor excludes credentials');
 await waitFor(()=>evaluate(()=>document.getElementById('create-game').options.length===10),'Live game catalogue did not load all ten games.');
 check(await evaluate(()=>document.getElementById('create-game').options.length===10),'Ten games rendered from the live API');
 await waitFor(()=>evaluate(id=>document.getElementById('episode-title').textContent.includes('Hanabi')&&document.getElementById('episode-subtitle').textContent.includes(id)&&document.getElementById('artifacts').querySelectorAll('[data-download-artifact]').length>=6&&document.getElementById('model-messages').querySelectorAll('.model-message').length>0,episodeId),'Existing Hanabi rollout, messages or artifacts did not render.');
 const ui=await evaluate(()=>({phase:document.getElementById('connection-status').dataset.state,label:document.getElementById('connection-status-label').textContent,reason:document.getElementById('connection-reason').textContent,address:document.getElementById('connection-address').textContent,checkedAt:document.getElementById('connection-checked').textContent,lightRgb:getComputedStyle(document.getElementById('connection-light')).backgroundColor.match(/\d+/g).slice(0,3).map(Number),title:document.getElementById('episode-title').textContent,subtitle:document.getElementById('episode-subtitle').textContent,outcome:document.getElementById('outcome-badge').textContent,timelineMaximum:Number(document.getElementById('timeline').max),gameCount:document.getElementById('create-game').options.length,artifactCount:document.getElementById('artifacts').querySelectorAll('[data-download-artifact]').length,messageCards:document.getElementById('model-messages').querySelectorAll('.model-message').length,credentialInputEmpty:!document.getElementById('admin-token').value}));
 check(ui.phase==='connected'&&ui.lightRgb[1]>ui.lightRgb[0]+30&&ui.lightRgb[1]>ui.lightRgb[2]+30,'Visible status indicator is green after real identity validation');
 check(ui.address.includes(apiUrl)&&ui.label==='已连接','UI identifies the actual verified 34935 API address');
 check(ui.outcome.includes('23')&&ui.timelineMaximum>=60,'Existing 23-point Hanabi rollout and recorded timeline rendered');
 check(ui.credentialInputEmpty,'Credential input remains empty during automatic restored login');
 report.ui=ui;
 await evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const screenshot=await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});check(!screenshot.isEmpty(),'Hidden live desktop screenshot captured');writeFileSync(join(output,'connected.png'),screenshot.toPNG());
 await evaluate(()=>document.getElementById('settings-open').click());
 await waitFor(()=>evaluate(()=>!document.getElementById('password-form').hidden),'Live account settings did not load.');
 const account=await remote.getAccount();
 check(account.userId==='owner'&&account.role==='operator','Live Settings reads the existing individual account');
 report.account={userId:account.userId,role:account.role,passwordConfigured:account.passwordConfigured};
 await evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const settingsScreenshot=await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});writeFileSync(join(output,'settings.png'),settingsScreenshot.toPNG());
 check(requests.every(item=>item.method==='GET'),'All live API traffic was read-only GET');
 check(!window.isVisible(),'Isolated Electron window remained hidden');
 report.screenshot='artifacts/cloud-api34935-desktop-live-check/connected.png';report.ok=true;
 await cleanup();process.stdout.write(JSON.stringify({ok:true,checks:checks.length,requests:requests.length,report:'artifacts/cloud-api34935-desktop-live-check/report.json',screenshot:report.screenshot})+'\n');app.exit(0);
}
app.on('before-quit',()=>{remote?.invalidate();ownerToken='';});
// Keep the isolated process alive until cleanup and the final report are saved.
app.on('window-all-closed',()=>{});
main().catch(async error=>{report.ok=false;report.error=safeError(error);report.failedCheck=error?.name==='AssertionError'?String(error.message).split('\n')[0]:undefined;try{if(window&&!window.isDestroyed())report.uiFailure=await evaluate(()=>({phase:document.getElementById('connection-status')?.dataset.state,reason:document.getElementById('connection-reason')?.textContent,checkedAt:document.getElementById('connection-checked')?.textContent}));}catch{}await cleanup();process.stdout.write(JSON.stringify({ok:false,error:report.error,report:'artifacts/cloud-api34935-desktop-live-check/report.json'})+'\n');app.exit(1);});
