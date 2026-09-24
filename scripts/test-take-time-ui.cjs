// Run with Electron. Uses only synthetic API projections, never a game engine.
const { app, BrowserWindow, ipcMain }=require('electron');
const assert=require('node:assert/strict');
const { mkdir, writeFile }=require('node:fs/promises');
const { resolve }=require('node:path');
app.whenReady().then(async()=>{
const output=resolve('artifacts/take-time-ui');await mkdir(output,{recursive:true});
app.setPath('userData',resolve(output,'profile'));
const window=new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{preload:resolve('test/fixtures/take-time-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
const errors=[],commands=[];let failNext=false;window.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
const cards=[{id:'synthetic-solar',color:'solar',value:4},{id:'synthetic-lunar',color:'lunar',value:9}],example={type:'place',cardId:'synthetic-solar',position:2,faceUp:false};
let state={status:'your-turn',mode:'human',room:{roomId:'fixture',episodeId:'fixture',gameId:'take-time',playerId:'p3',playerCount:3,members:[1,2,3].map(n=>({playerId:`p${n}`,name:n===2?'较长的队友名称用于窄屏验收':'玩家 '+n,ready:true}))},rules:{name:'时序谜局',rulesSummary:['仅使用本局 API。'],implementation:{},sources:[]},observation:{gameId:'take-time',observationId:'before',playerId:'p3',status:'active',control:{required:true,deadlineAt:Date.now()+180000},legalActions:[{type:'place',examples:[example,{...example,faceUp:true}],schema:{properties:{}}}],view:{playerId:'p3',phase:'playing',playerIds:['p1','p2','p3'],activePlayerIds:['p3'],currentPlayerId:'p3',lookedPlayerIds:['p1','p2','p3'],hand:cards,handCounts:{p1:3,p2:3,p3:2},cardBacks:{p1:{hand:['solar','lunar']},p2:{hand:['lunar']},p3:{hand:['solar','lunar']}},reserveCounts:{},placements:[{turn:1,playerId:'p1',position:1,color:'solar',faceUp:false,value:null}],ownPlacements:[],faceUpRemaining:2,clock:{name:'VIII-1 · 合成界面验收',angle:0,start:3,rotation:1,positions:[1,2,3,4,5,6].map(n=>({position:n,sector:n,conditions:n===4?['不能直接放牌']:n===1?['总和最接近 12（允许并列）']:[]}))},rules:{clock:{conditions:['从 API 读取合成条件。']}},discussion:[{playerId:'p1',text:'讨论发生在看牌之前。'}]}}};
ipcMain.handle('take-time-test-command',(_event,name,input)=>{if(name==='incoming-invitation')return '';if(name==='act'){if(failNext){failNext=false;throw Error('合成拒绝：观察已更新');}commands.push(input);state={...state,status:'waiting',observation:{...state.observation,observationId:'after',legalActions:[],view:{...state.observation.view,currentPlayerId:'p1',activePlayerIds:['p1']},control:{required:false}}};}return state;});
const js=code=>window.webContents.executeJavaScript(code).catch(error=>{throw Error(code+' : '+error.message+' renderer '+JSON.stringify(errors));});
const frame=()=>js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
const screenshot=async name=>{await frame();await writeFile(resolve(output,name),(await window.webContents.capturePage()).toPNG());};
try {
  await window.loadFile(resolve('web/player.html'));for(let i=0;i<50;i++){if(await js("document.querySelector('.tt-slot')!==null"))break;await new Promise(r=>setTimeout(r,50));}await frame();
  assert.equal(await js("document.querySelectorAll('.tt-slot').length"),6);
  assert.deepEqual(await js("[...document.querySelectorAll('.tt-seat')].map(e=>e.dataset.player)"),['p1','p2','p3']);
  assert.equal(await js("document.querySelector('#action-form').hidden"),true);
  assert.equal(await js("document.querySelector('.tt-card[data-card=synthetic-lunar]').disabled"),true);
  assert.ok((await js("document.querySelector('.tt-slot[data-position=\"1\"]').textContent")).includes('?'));
  await js("document.querySelector('.tt-card[data-card=synthetic-solar]').click();document.querySelector('.tt-slot[data-position=\"2\"] button').click()");
  assert.equal(commands.length,0);assert.equal(await js("document.querySelector('.tt-confirm').disabled"),false);
  await screenshot('desktop-placement.png');
  window.setContentSize(390,844);await screenshot('phone-placement.png');
  assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true,'no horizontal overflow');
  await js("document.querySelector('.tt-reason textarea').value='只依据本人牌面选择位置。';document.querySelector('.tt-confirm').click();document.querySelector('.tt-confirm')?.click()");await frame();
  assert.equal(commands.length,1);assert.deepEqual(commands[0],{action:example,observationId:'before',decisionSummary:'只依据本人牌面选择位置。'});
  assert.equal(await js("document.querySelector('#turn-label').textContent"),'玩家 1 行动中');
  assert.equal(await js("document.querySelector('.tt-confirm')"),null);
  await js("document.querySelector('#rules-button').click()");assert.ok((await js("document.querySelector('#rules-content').textContent")).includes('从 API 读取合成条件'));await js("document.querySelector('#close-rules').click()");
  // A recorded frame is rendered from its own projection, with no future value.
  await js(`window.CoopTakeTime.renderBoard(document.querySelector('#board'),${JSON.stringify(state.observation.view)},{compact:true})`);
  assert.ok((await js("document.querySelector('.tt-slot[data-position=\"1\"]').textContent")).includes('?'));
  await screenshot('phone-replay.png');
  // Discussion, raw text escaping and safe controls before looking.
  const discussion={...state,observation:{...state.observation,observationId:'discussion',view:{...state.observation.view,phase:'discussion',hand:null,lookedPlayerIds:[],activePlayerIds:['p1','p2','p3'],currentPlayerId:null,discussion:[{playerId:'p1',text:'<script>alert(1)</script>'}]},legalActions:[{type:'speak',schema:{properties:{}}},{type:'look_hand',examples:[{type:'look_hand'}],schema:{properties:{}}}],control:{required:true}}};
  await js(`render(${JSON.stringify(discussion)})`);assert.equal(await js("document.querySelectorAll('.tt-discussion script').length"),0);assert.equal(await js("document.querySelector('.tt-look').disabled"),false);
  await screenshot('phone-discussion.png');
  // Receiving an opaque face-down card exposes only color and destination.
  const passed={...discussion,observation:{...discussion.observation,observationId:'pass',view:{...discussion.observation.view,phase:'playing',hand:[],pendingCard:{owner:'p2',recipient:'p3',color:'lunar',faceUp:false,value:null}},legalActions:[{type:'place_passed',examples:[{type:'place_passed',position:2}],schema:{properties:{}}}]}};
  await js(`render(${JSON.stringify(passed)})`);await js("document.querySelector('.tt-slot[data-position=\"2\"] button').click()");assert.ok((await js("document.querySelector('.tt-preview').textContent")).includes('暗牌'));await screenshot('phone-transfer.png');
  failNext=true;await js("document.querySelector('.tt-confirm').click()");await frame();
  assert.ok((await js("document.querySelector('#notice').textContent")).includes('合成拒绝'));
  assert.equal(await js("document.querySelector('.tt-confirm').disabled"),false,'retry remains usable after rejection');
  const terminal={...state,observation:{...state.observation,status:'completed',view:{...state.observation.view,phase:'finished',hand:[],result:{won:false,sums:[1,2,3,4,5,6],violations:['位置 6 张数不符']}},legalActions:[],control:{required:false}}};
  await js(`render(${JSON.stringify(terminal)})`);assert.ok((await js("document.querySelector('.tt-result').textContent")).includes('位置 6 张数不符'));assert.equal(await js("document.querySelector('.tt-confirm')"),null);await screenshot('phone-terminal.png');
  await js(`window.CoopTakeTime.renderOptions(document.querySelector('#board'),{setupSchema:{properties:{bonusTokens:{minimum:0,maximum:3},rebirth:{title:'合成设置',options:[{id:'second-hand',name:'秒针',description:'合成描述'}]}}}});document.querySelector('[data-option=bonusTokens]').value='2';document.querySelector('input[data-option=rebirth]').checked=true;document.querySelector('[data-option=secondHandStart]').value='4'`);
  assert.deepEqual(await js("window.CoopTakeTime.readOptions(document.querySelector('#board'))"),{bonusTokens:2,rebirth:['second-hand'],secondHandStart:4});
  await js("window.CoopTakeTime.renderOptions(document.querySelector('#board'),{});");assert.equal(await js("window.CoopTakeTime.readOptions(document.querySelector('#board'))"),undefined);
  assert.deepEqual(errors,[]);await writeFile(resolve(output,'result.json'),JSON.stringify({passed:true,checks:['own seat order','API legal selection','preview before submit','single current observation submission with private human reason','waiting actor','rules','opaque replay','discussion escaping','opaque transfer','390px no overflow','recoverable rejection','terminal condition report','creation config and old server'],screenshots:6},null,2));
  console.log('Take Time real-render UI checks passed.');
} catch(error){console.error(error,errors);process.exitCode=1;} finally {window.destroy();app.exit(process.exitCode??0);}

}).catch(error=>{console.error(error);app.exit(1);});
