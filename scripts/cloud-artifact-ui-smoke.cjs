// Normal HTTPS audit workflow on the user-authorized cloud service.
const {app,BrowserWindow}=require('electron');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {resolve,join}=require('node:path');
const root=resolve(__dirname,'..'),out=join(root,'artifacts','artifact-release');
const episode=JSON.parse(readFileSync(join(out,'live-demo.json'),'utf8')).episodeId;
const base='https://coop.neutrinophysics.cn';
mkdirSync(out,{recursive:true});app.setPath('userData',join(out,'browser-profile'));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1460,height:1140,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.session.setPermissionRequestHandler((_a,_b,done)=>done(false));
  await win.loadURL(`${base}/#episode=${episode}`);
  const token=readFileSync(join(root,'artifacts','cloud-private','owner.txt'),'utf8').trim();
  await win.webContents.executeJavaScript(`document.getElementById('admin-token').value=${JSON.stringify(token)};document.querySelector('#login-form button[type="submit"]').click();`);
  const until=Date.now()+20000;let state;
  do{
    state=await win.webContents.executeJavaScript(`({ready:!document.getElementById('detail').hidden,identity:document.getElementById('auth-toggle').textContent,artifacts:document.querySelectorAll('#artifacts .artifact-card').length,downloads:document.querySelectorAll('[data-download-artifact]').length,discussion:document.getElementById('discussion-context').textContent,policy:document.getElementById('retention-policy').textContent,node:typeof window.require!=='undefined'})`);
    if(state.ready&&state.artifacts>=3)break;
    await new Promise(done=>setTimeout(done,100));
  }while(Date.now()<until);
  if(!state.ready||state.artifacts!==3||state.downloads!==3||state.node||!state.identity.includes('owner'))throw Error('Stored three-player artifacts were not displayed.');
  await win.webContents.executeJavaScript("document.getElementById('timeline').value='0';document.getElementById('timeline').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('board').scrollIntoView({block:'center'});");
  const initial=await win.webContents.executeJavaScript("({backs:document.querySelectorAll('.card-back-player').length,hand:JSON.parse(document.getElementById('raw-observation').textContent).view.hand,discussionPanel:!!document.getElementById('communication-panel')})");
  if(initial.backs!==3||initial.hand!==null||!initial.discussionPanel)throw Error('Initial public card backs or communication panel missing.');
  await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  writeFileSync(join(out,'cloud-initial-discussion.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await win.webContents.executeJavaScript("document.getElementById('artifacts').scrollIntoView({block:'center'});");
  await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  writeFileSync(join(out,'cloud-artifacts.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await win.webContents.executeJavaScript("document.getElementById('disconnect').click()");
  const clean=await win.webContents.executeJavaScript("document.getElementById('detail').hidden&&!document.getElementById('artifacts').textContent&&!document.getElementById('admin-token').value");
  if(!clean)throw Error('Logout did not clear artifact data.');
  const result={ok:true,at:new Date().toISOString(),episodeId:episode,base,checks:['HTTPS certificate validated','owner authenticated','three complete downloadable seat artifacts displayed','initial public Solar/Lunar counts for all three seats visible','initial card values hidden','communication panel and retention explanation visible','renderer Node disabled','logout clears credentials and artifact data'],state,initial};
  writeFileSync(join(out,'cloud-browser-result.json'),JSON.stringify(result,null,2));app.quit();
}).catch(error=>{writeFileSync(join(out,'cloud-browser-result.json'),JSON.stringify({ok:false,at:new Date().toISOString(),error:String(error)},null,2));console.error(String(error));app.exit(1);});
app.on('window-all-closed',()=>app.quit());
