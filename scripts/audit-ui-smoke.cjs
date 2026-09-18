// Run with Electron. Exercises the actual frontend in a sandboxed Chromium
// renderer, with the same preload as the desktop app. Never prints credentials.
const {app,BrowserWindow,ipcMain}=require('electron');
const {readFileSync,writeFileSync,mkdirSync}=require('node:fs');
const {join,resolve}=require('node:path');
const root=resolve(__dirname,'..'),output=join(root,'artifacts','rollout-ui-smoke');
mkdirSync(output,{recursive:true});app.setPath('userData',join(output,'profile'));
const data=join(root,'data','local-server');
const connection=JSON.parse(readFileSync(join(data,'connection.json'),'utf8'));
const token=readFileSync(join(data,'coordinator-token'),'utf8').trim();
const episodeId=JSON.parse(readFileSync(join(root,'artifacts','http-agent-demo-2026-09-17','episode.json'),'utf8')).episodeId;
let window;
async function browserChecks(episodeId){
  const $=id=>document.getElementById(id),checks=[];
  const assert=(value,message)=>{if(!value)throw Error(message);checks.push(message);};
  const wait=async(fn,label)=>{const end=Date.now()+15000;while(!fn()){if(Date.now()>end)throw Error('Timeout: '+label+'; '+($('message')?.textContent??''));await new Promise(r=>setTimeout(r,40));}};
  await wait(()=>$('episode-list')?.querySelector('button'),'authenticated rollout library');
  $('episode-list').querySelector('button').click();
  await wait(()=>!$('detail').hidden&&$('timeline').max!=='0','rollout detail');
  const info=await window.coopDesktop.getConnection();
  const response=await fetch(info.apiUrl+'/rollouts/'+episodeId,{headers:{Authorization:'Bearer '+info.adminToken}});
  const rollout=await response.json();
  assert(response.ok,'rollout detail API available');
  assert(rollout.summary.outcome.success===true,'original winning episode preserved');
  assert(rollout.annotations.length>=5,'three reflections and two reviews persisted');
  assert($('episode-title').textContent.includes('Take Time'),'game title rendered');
  assert(Number($('timeline').max)===rollout.frames.length-1,'timeline covers every stored event');
  assert(typeof window.require==='undefined'&&typeof window.process==='undefined','renderer has no Node primitives');
  const choose=(id,value)=>{$(id).value=String(value);$(id).dispatchEvent(new Event('change',{bubbles:true}));};
  const step=index=>{$('timeline').value=String(index);$('timeline').dispatchEvent(new Event('input',{bubbles:true}));};
  const raw=()=>{try{return JSON.parse($('raw-observation').textContent);}catch{return null;}};
  assert($('player-view').value==='actor','default perspective follows the acting player');
  let followsEveryActor=true;
  for(let i=0;i<rollout.frames.length;i++)if(rollout.frames[i].playerId&&rollout.frames[i].views?.[rollout.frames[i].playerId]){
    step(i);if((raw()?.view??{}).playerId!==rollout.frames[i].playerId)followsEveryActor=false;
  }
  assert(followsEveryActor,'automatic perspective follows every recorded actor without future backfill');
  const placementIndex=rollout.frames.findIndex(f=>f.kind==='accepted'&&f.playerId==='p1'&&f.action?.type==='place'&&f.action.position===3);
  assert(placementIndex>0,'audited dark-card move found');
  step(placementIndex);choose('observation-mode','after');choose('player-view','p1');
  await wait(()=>Boolean(raw()),'after-view rendering');
  const current=raw(),view=current.view??current;
  assert(view.placements.at(-1).value===null,'historical public dark value stays hidden');
  assert(view.ownPlacements.some(p=>p.value===3),'own dark card remains in own recorded memory');
  assert(!view.result,'no terminal result inserted into historical view');
  const known=$('board').querySelector('.clock-slot[data-position="3"] .game-card');
  assert(known?.dataset.known==='true'&&known.textContent.includes('己知'),'own dark card visibly marked as known to its owner');
  choose('player-view','p2');
  assert(/未记录|未录制|不可用/.test($('board').textContent+$('view-caption').textContent),'missing legacy other-seat snapshot marked unavailable');
  choose('observation-mode','before');
  assert(!raw()&&!$('board').querySelector('.game-card')&&$('view-caption').textContent.includes('p1'),'another actor input is not relabeled');
  choose('player-view','p1');
  await wait(()=>Boolean(raw()),'before-view rendering');
  const before=raw();assert((before.view??before).hand.length===3,'exact action-before hand shown');
  choose('observation-mode','after');step(placementIndex+1);choose('player-view','p2');
  const partial=$('board').querySelector('.clock-slot[data-position="3"] .slot-sum').textContent;
  assert(partial.includes('8')&&partial.includes('?'),'partly unknown sum does not use hidden teammate value');
  choose('observation-mode','after');step(rollout.frames.length-1);choose('player-view','p3');
  await wait(()=>Boolean((raw()?.view??raw())?.result),'terminal view');
  assert(JSON.stringify((raw().view??raw()).result.sums)==='[1,10,11,14,22,25]','terminal sums correctly rendered');
  assert($('annotations').textContent.includes('最大'),'reflection text visible');
  $('previous').click();assert(Number($('timeline').value)===rollout.frames.length-2,'previous-step control');
  $('next').click();assert(Number($('timeline').value)===rollout.frames.length-1,'next-step control');
  step(placementIndex);choose('player-view','p1');
  $('refresh').click();await wait(()=>!$('refresh').disabled,'refresh');
  assert(Number($('timeline').value)===placementIndex,'refresh preserves historical cursor');
  // Simulate an untrusted annotation in this renderer only; the DB is untouched.
  const realFetch=window.fetch;
  window.fetch=async(...args)=>{
    const r=await realFetch(...args),url=String(args[0]);
    if(url.endsWith('/rollouts/'+episodeId)&&r.ok){const body=await r.json();body.annotations.push({id:'xss-smoke',kind:'review',text:'<img src=x onerror="window.__auditXss=1">',source:'ui-test',createdAt:new Date().toISOString()});return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});}
    return r;
  };
  $('refresh').click();await wait(()=>$('annotations').textContent.includes('onerror'),'untrusted text rendered');
  assert(!window.__auditXss&&!$('annotations').querySelector('img'),'untrusted annotation is text, not executable HTML');
  window.fetch=realFetch;$('refresh').click();await wait(()=>!$('annotations').textContent.includes('onerror'),'restore real evidence');
  // Exercise the generic visualizer and all public communication types using a
  // renderer-only fixture. This does not create another server-side episode.
  window.fetch=async(...args)=>{
    const r=await realFetch(...args),url=String(args[0]);
    if(url.endsWith('/rollouts/'+episodeId)&&r.ok){
      const body=await r.json();body.summary.gameId='generic-ui-fixture';
      const texts=body.frames.filter(f=>f.action?.type==='speak');
      texts[0].action.type='chat';texts[1].action.type='message';
      texts[2].action={type:'hint',target:'p2',kind:'value',value:3};
      texts[3].action={type:'communicate',cardId:'test-public-card',relation:'highest'};
      texts[4].action={type:'signal',target:'p3'};
      return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
    }return r;
  };
  $('refresh').click();await wait(()=>Boolean($('board').querySelector('.field-grid')),'generic visualizer');
  choose('observation-mode','after');step(rollout.frames.length-1);choose('player-view','p3');
  assert($('discussion-count').textContent.includes('6'),'text and structured public communication types appear in timeline discussion');
  assert($('board').querySelectorAll('.field-card').length>0,'generic game state rendered as structured field cards');
  window.fetch=realFetch;$('refresh').click();await wait(()=>Boolean($('board').querySelector('.clock-board'))&&!$('refresh').disabled,'restore real game');
  choose('observation-mode','after');step(rollout.frames.length-1);choose('player-view','p3');
  assert([...$('board').querySelectorAll('.slot-sum strong')].map(x=>x.textContent).join(',')==='1,10,11,14,22,25','visible board sums match the verified result');
  await document.fonts.ready;
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  assert(document.documentElement.scrollWidth<=innerWidth+1,'desktop layout has no horizontal overflow');
  return {checks,episodeId,frames:rollout.frames.length,annotations:rollout.annotations.length,placementIndex};
}
app.whenReady().then(async()=>{
  window=new BrowserWindow({width:1600,height:1100,show:false,webPreferences:{preload:join(root,'desktop','preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const valid=event=>{if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||new URL(event.senderFrame.url).origin!==new URL(connection.baseUrl).origin)throw Error('Invalid test renderer');};
  ipcMain.handle('coop:get-connection',event=>{valid(event);return {...connection,adminToken:token};});
  ipcMain.handle('coop:copy-text',event=>{valid(event);});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.session.setPermissionRequestHandler((_a,_b,done)=>done(false));
  await window.loadURL(connection.baseUrl+'/#episode='+episodeId);
  const result=await window.webContents.executeJavaScript('('+browserChecks.toString()+')('+JSON.stringify(episodeId)+')',true);
  const picture=await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
  if(picture.isEmpty())throw Error('Empty browser screenshot');
  writeFileSync(join(output,'take-time-final.png'),picture.toPNG());
  await window.webContents.executeJavaScript("document.querySelector('.board-panel').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  writeFileSync(join(output,'take-time-board.png'),(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  window.setContentSize(1000,900);
  const responsive=await window.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}))))');
  if(responsive.scrollWidth>responsive.width+1)throw Error('Responsive layout overflows horizontally');
  writeFileSync(join(output,'compact.png'),(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  writeFileSync(join(output,'result.json'),JSON.stringify({ok:true,checkedAt:new Date().toISOString(),...result,responsive},null,2));
  console.log(JSON.stringify({ok:true,checks:result.checks.length,output}));app.quit();
}).catch(error=>{writeFileSync(join(output,'result.json'),JSON.stringify({ok:false,error:String(error),stack:error.stack},null,2));console.error(String(error));app.exit(1);});
app.on('window-all-closed',()=>app.quit());
