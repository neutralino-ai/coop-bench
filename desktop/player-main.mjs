import {app,BrowserWindow,protocol,ipcMain,safeStorage,clipboard,dialog} from 'electron';
import {mkdirSync,readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PlayerRuntime,MinimalAgent,invitation,inviteUrl} from '../runtime/coop-bench/client/player.mjs';

protocol.registerSchemesAsPrivileged([{scheme:'coopplayer',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const here=dirname(fileURLToPath(import.meta.url)),argument=process.argv.find(a=>a.startsWith('--data-dir='))?.slice(11);
const directory=argument?resolve(argument):join(app.getPath('appData'),'Coop Bench Player');mkdirSync(directory,{recursive:true});app.setPath('userData',directory);app.setName('Coop Bench Player');
const sessionFile=join(directory,'membership.encrypted'),assets={'/':'player.html','/player.js':'player.js','/player.css':'player.css'};
let window,runtime,quitting=false,joining=false,activeMode='human',pendingInvitation='';
function receiveInvitation(value){
  if(typeof value!=='string'||!value.startsWith('coopbench:'))return;
  try{invitation(value);pendingInvitation=value.trim();if(window&&!window.isDestroyed()&&!window.webContents.isLoading())window.webContents.send('player:invitation',pendingInvitation);}catch{}
}
for(const arg of process.argv)receiveInvitation(arg);
app.on('open-url',(event,url)=>{event.preventDefault();receiveInvitation(url);window?.show();window?.focus();});
const trusted=url=>{try{const u=new URL(url);return u.protocol==='coopplayer:'&&u.host==='app'&&u.pathname==='/';}catch{return false;}};
function saved() {if(!existsSync(sessionFile)||!safeStorage.isEncryptionAvailable())return null;try{return JSON.parse(safeStorage.decryptString(readFileSync(sessionFile)));}catch{return null;}}
async function connect(input,resume=false) {
  if(runtime||joining)throw Error('请先断开当前席位。');
  const prior=saved(),config=resume?prior:{...invitation(input.invitation),name:input.name};if(!config)throw Error('没有可恢复的本地席位。');
  if(!resume&&prior?.roomId===config.roomId&&prior?.apiUrl===config.apiUrl)config.playerToken=prior.playerToken;
  // A saved seat resumes with its own credential even after the invitation was
  // rotated. Invitations are for joining, not persistent seat authentication.
  if(resume)delete config.inviteToken;
  const agent=input.mode==='model'?new MinimalAgent({baseUrl:input.baseUrl,apiKey:input.apiKey,model:input.model}):null;
  activeMode=agent?'model':'human';
  const next=new PlayerRuntime({...config,directory:join(directory,config.roomId)});
  joining=true;
  try{
    if(safeStorage.isEncryptionAvailable())writeFileSync(sessionFile,safeStorage.encryptString(JSON.stringify(next.credentials())),{mode:0o600});
    next.on('state',state=>{if(!window?.isDestroyed())window.webContents.send('player:state',{...state,mode:activeMode});});
    for(const event of ['trace-warning','agent-warning','connection-warning'])next.on(event,message=>{if(!window?.isDestroyed())window.webContents.send('player:state',{...next.snapshot(),mode:activeMode,warning:message});});
    if(agent)next.attachAgent(agent);await next.connect();runtime=next;next.run().catch(()=>{});return {...next.snapshot(),mode:activeMode};
  }catch(error){await next.close();throw error;}finally{joining=false;}
}
async function main() {
  if(!app.requestSingleInstanceLock()){app.quit();return;}await app.whenReady();
  protocol.handle('coopplayer',request=>{
    const u=new URL(request.url),file=assets[u.pathname];if(request.method!=='GET'||u.host!=='app'||u.search||!file)return new Response('Not found',{status:404});
    return new Response(readFileSync(join(here,'../runtime/coop-bench/web',file)),{headers:{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',
      'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'",'Cache-Control':'no-store'}});
  });
  ipcMain.handle('player:command',async(event,{name,input={}}={})=>{
    if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!trusted(event.senderFrame.url))throw Error('Untrusted player window.');
    try{
      if(JSON.stringify(input).length>65536)throw Error('输入过大。');let value;
      if(name==='join')value=await connect(input);
      else if(name==='incoming-invitation'){value=pendingInvitation;pendingInvitation='';}
      else if(name==='resume')value=await connect(input,true);
      else if(name==='status')value=runtime?{...runtime.snapshot(),mode:activeMode}:{status:'disconnected',canResume:Boolean(saved())};
      else if(name==='disconnect'){await runtime?.close();runtime=null;value={status:'disconnected',canResume:Boolean(saved())};}
      else {
        if(!runtime)throw Error('请先加入房间。');
        if(name==='ready')value=await runtime.ready(input.ready!==false);
        else if(name==='start')value=await runtime.roomCommand('start');
        else if(name==='leave'){await runtime.roomCommand('leave');await runtime.close();runtime=null;if(existsSync(sessionFile))unlinkSync(sessionFile);value={status:'disconnected',canResume:false};}
        else if(name==='kick')value=await runtime.roomCommand('kick',{playerId:input.playerId});
        else if(name==='invite'){const room=await runtime.roomCommand('invite');clipboard.writeText(inviteUrl({...room,apiUrl:runtime.credentials().apiUrl}));value={copied:true};}
        else if(name==='act')value=await runtime.act(input.action,input.observationId);
        else throw Error('不支持此操作。');
      }
      // Runtime act responses contain decisionToken; the human renderer gets only its safe snapshot.
      return {ok:true,value:name==='act'?{...runtime.snapshot(),mode:activeMode}:value};
    }catch(error){return {ok:false,error:error.code?`${error.code}：操作未完成，请刷新本席状态。`:['join','resume'].includes(name)?'连接或加入失败，请检查邀请链接、网络及模型配置。':String(error.message).slice(0,200)};}
  });
  window=new BrowserWindow({title:'Coop Bench Player · 参赛',width:1200,height:820,minWidth:950,minHeight:650,backgroundColor:'#f3f5f2',show:false,autoHideMenuBar:true,
    webPreferences:{preload:join(here,'player-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event,url)=>{if(!trusted(url))event.preventDefault();});
  window.webContents.on('will-redirect',event=>event.preventDefault());window.webContents.on('will-attach-webview',event=>event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_w,_p,callback)=>callback(false));window.webContents.session.setPermissionCheckHandler(()=>false);
  window.once('ready-to-show',()=>window.show());await window.loadURL('coopplayer://app/');
  if(process.argv.includes('--player-smoke-test')){
    if(!argument)throw Error('Smoke requires --data-dir.');
    const {runPlayerSmoke}=await import('./player-smoke.mjs');const result=await runPlayerSmoke({window,directory});
    writeFileSync(join(directory,'player-smoke-result.json'),JSON.stringify({...result,packaged:app.isPackaged,platform:process.platform,arch:process.arch,version:app.isPackaged?app.getVersion():JSON.parse(readFileSync(join(here,'../package.json'),'utf8')).version,electronVersion:process.versions.electron},null,2));app.quit();
  }
}
app.on('window-all-closed',()=>app.quit());app.on('before-quit',event=>{if(runtime&&!quitting){event.preventDefault();quitting=true;runtime.close().finally(()=>{runtime=null;app.quit();});}});
app.on('second-instance',(_event,argv)=>{for(const arg of argv)receiveInvitation(arg);window?.show();window?.focus();});main().catch(error=>{
  if(process.argv.includes('--player-smoke-test'))writeFileSync(join(directory,'player-smoke-result.json'),JSON.stringify({ok:false,error:String(error.message),stack:error.stack},null,2));
  else dialog.showErrorBox('参赛客户端启动失败',String(error.message));app.exit(1);
});
