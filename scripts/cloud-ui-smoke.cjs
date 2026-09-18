// Normal authenticated browser workflow only; no attack or malformed requests.
const {app,BrowserWindow}=require('electron');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {resolve,join}=require('node:path');
const root=resolve(__dirname,'..'),output=join(root,'artifacts','security-2026-09-17');
mkdirSync(output,{recursive:true});app.setPath('userData',join(output,'cloud-browser-profile'));
const base='https://coop.neutrinophysics.cn';
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1440,height:1040,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.session.setPermissionRequestHandler((_a,_b,done)=>done(false));
  await win.loadURL(base);
  const token=readFileSync(join(root,'artifacts','cloud-private','owner.txt'),'utf8').trim();
  // The value is passed inside the test process, never written to logs/reports.
  await win.webContents.executeJavaScript(`document.getElementById('admin-token').value=${JSON.stringify(token)};document.querySelector('#login-form button[type="submit"]').click();`);
  const deadline=Date.now()+20000;
  let result;
  while(Date.now()<deadline){
    result=await win.webContents.executeJavaScript(`({ready:!document.getElementById('detail').hidden,identity:document.getElementById('auth-toggle').textContent,title:document.getElementById('episode-title').textContent,notes:document.getElementById('annotations').textContent,message:document.getElementById('message').textContent,frames:Number(document.getElementById('timeline').max)+1,hasNode:typeof window.require!=='undefined'})`);
    if(result.ready)break;
    await new Promise(r=>setTimeout(r,100));
  }
  if(!result.ready||!result.identity.includes('owner')||!result.title.includes('Take Time')||result.hasNode)throw Error('Cloud browser login/rollout display failed: '+result.message);
  await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  writeFileSync(join(output,'cloud-audit.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await win.webContents.executeJavaScript("document.getElementById('disconnect').click()");
  const logout=await win.webContents.executeJavaScript("({hidden:document.getElementById('detail').hidden,empty:!document.getElementById('raw-observation').textContent&&!document.getElementById('board').textContent,inputEmpty:!document.getElementById('admin-token').value})");
  if(!logout.hidden||!logout.empty||!logout.inputEmpty)throw Error('Logout did not clear visible private data');
  const report={ok:true,at:new Date().toISOString(),base,checks:['HTTPS page loaded with certificate validation','owner credential authenticated','stored cloud rollout displayed','renderer Node access disabled','logout clears page data and credential'],frames:result.frames,identity:result.identity};
  writeFileSync(join(output,'cloud-browser-result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:true,checks:report.checks.length}));app.quit();
}).catch(error=>{writeFileSync(join(output,'cloud-browser-result.json'),JSON.stringify({ok:false,at:new Date().toISOString(),error:String(error)},null,2));console.error(String(error));app.exit(1);});
app.on('window-all-closed',()=>app.quit());
