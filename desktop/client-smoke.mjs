// Isolated synthetic UI acceptance data. Never connects to the production service.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startMockApi } from './mock-api.mjs';
export const startClientFixture = () => startMockApi();

export async function runClientSmoke({ window, fixture, remote, player, hostSeats, dataDir, getCopied }) {
  const apiReads=[],fetcher=remote.fetcher,artifactAttempts=[];let failDetail=false,artifactRetryAt=0;
  remote.fetcher=async(url,options)=>{
    const path=new URL(url).pathname+new URL(url).search;apiReads.push(path);
    if(/\/artifacts\/[^/?]+\/content$/.test(path)){
      artifactAttempts.push(Date.now());
      if(!artifactRetryAt)artifactRetryAt=Date.now()+5000;
      if(Date.now()<artifactRetryAt)return Response.json({error:{code:'RATE_LIMITED',message:'Synthetic artifact download cooldown'}},{status:429,headers:{'Retry-After':'5'}});
    }
    if(/\/rollouts\/[^/?]+$/.test(path)){
      await new Promise(resolve=>setTimeout(resolve,800));
      if(failDetail){failDetail=false;return Response.json({error:{code:'SYNTHETIC_FAILURE',message:'Synthetic loading failure'}},{status:503});}
    }
    return fetcher(url,options);
  };
  const checks = [], check = (value, name) => { assert.ok(value, name); checks.push(name); };
  const run = (fn, ...args) => window.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true)
    .catch(error=>{throw Error(`Synthetic UI check failed: ${fn.toString().slice(0,300)}: ${error.message}`);});
  const wait = async (fn, message) => { const deadline = Date.now() + 18000; while (!await fn()) { if (Date.now() > deadline) throw new Error(message); await new Promise(r => setTimeout(r, 50)); } };
  const screenshots = {};
  const capture = async name => {
    // DOM state changes precede the compositor frame. Wait for rendering so a
    // red-state assertion cannot be paired with an older yellow screenshot.
    await run(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const picture = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    assert.ok(!picture.isEmpty(), `Screenshot ${name} is not empty`);
    writeFileSync(join(dataDir, name), picture.toPNG()); screenshots[name] = { saved: true };
  };
  const status = () => run(() => ({
    phase: document.getElementById('connection-status').className.split(' ').at(-1),
    label: document.getElementById('connection-status-label').textContent,
    reason: document.getElementById('connection-reason').textContent,
    color: getComputedStyle(document.getElementById('connection-light')).backgroundColor.match(/\d+/g).slice(0, 3).map(Number),
  }));
  const red = value => value.color[0] > value.color[1] + 50 && value.color[0] > value.color[2] + 50;
  const green = value => value.color[1] > value.color[0] + 30 && value.color[1] > value.color[2] + 30;
  await wait(() => run(() => Boolean(window.coopTransport)), 'Bundled UI did not initialize.');
  await wait(async () => (await status()).phase === 'idle', 'Fresh isolated profile did not finish checking saved connection.');
  check(window.webContents.getURL().startsWith('coop://app/'), 'UI loads from packaged local assets');
  check(await run(() => typeof window.require === 'undefined' && typeof window.process === 'undefined'), 'renderer cannot access Node');
  const preferences = window.webContents.getLastWebPreferences();
  check(preferences.sandbox && preferences.contextIsolation && !preferences.nodeIntegration, 'sandbox and context isolation enabled');
  check(await run(() => !document.getElementById('auth-panel').hidden && document.body.dataset.view==='login' && getComputedStyle(document.querySelector('.workspace')).display==='none' && !document.getElementById('password-login-fields').hidden), 'fresh launch shows the password screen without lobby or audit clutter');
  await capture('client-login.png');
  const initial = await status();
  check(initial.phase === 'idle' && initial.label === '未连接' && Math.max(...initial.color) - Math.min(...initial.color) < 20, 'initial connection indicator is gray and explicitly not connected');
  // Well-formed but unauthorized, synthetic credential: reaches the fixture's
  // real authentication endpoint instead of only testing client validation.
  const invalidCredential = 'synthetic-invalid-credential-' + randomUUID();
  const connecting = await run((apiUrl, token) => {
    document.getElementById('credential-mode').click();
    document.getElementById('api-address').value = apiUrl;
    document.getElementById('admin-token').value = token;document.getElementById('login-user-id').value='owner';document.getElementById('login-password').value='Synthetic registration password 7!';
    document.getElementById('login-form').requestSubmit();
    return {
      phase: document.getElementById('connection-status').className.split(' ').at(-1),
      disabled: document.getElementById('connect-button').disabled,
      color: getComputedStyle(document.getElementById('connection-light')).backgroundColor.match(/\d+/g).slice(0, 3).map(Number),
    };
  }, fixture.apiUrl, invalidCredential);
  check(connecting.phase === 'connecting' && connecting.disabled && connecting.color[0] > connecting.color[1] && connecting.color[1] > connecting.color[2] + 50, 'in-flight login immediately displays yellow and prevents duplicate submits');
  await wait(async () => ['failed', 'expired'].includes((await status()).phase), 'Invalid fixture credential did not produce a failed connection state.');
  const rejected = await status();
  check(red(rejected) && /账号|密码|注册/.test(rejected.reason) && !remote.descriptor().connected, 'invalid credential displays a red light and authentication-specific explanation');
  await capture('client-connection-auth-failed.png');
  await run((apiUrl, token) => {
    document.getElementById('api-address').value = apiUrl;
    document.getElementById('admin-token').value = token;document.getElementById('login-user-id').value='owner';document.getElementById('login-password').value='Synthetic registration password 7!';
    document.getElementById('login-form').requestSubmit();
  }, fixture.apiUrl, fixture.adminToken);
  await wait(() => run(() => document.getElementById('create-game').options.length === 1 && !document.getElementById('disconnect').hidden), 'Login/game catalogue failed.');
  const connected = await status();
  check(connected.phase === 'connected' && connected.label === '已连接' && green(connected), 'valid credential displays a green light only after API identity verification');
  check(await run(() => !document.getElementById('admin-token').value), 'credential input cleared after login');
  const info = await run(() => window.coopDesktop.getConnection());
  check(info.connected && !Object.hasOwn(info, 'token') && !Object.hasOwn(info, 'adminToken'), 'connection descriptor contains no credential');
  check(!readFileSync(join(dataDir, 'remote-connection.json'), 'utf8').includes(fixture.adminToken), 'non-remembered token absent from disk config');
  await wait(()=>run(()=>document.body.dataset.view==='home' && document.querySelectorAll('#episode-list button').length>0),'Login did not land on the lobby.');
  check(await run(()=>document.querySelector('#home-replays .library') && getComputedStyle(document.getElementById('lobby-home')).display!=='none' && document.getElementById('detail').hidden), 'login displays permanent rooms and replay blocks without auto-opening a game');
  await capture('client-home.png');
  await run(id=>{void selectEpisode(id);},fixture.id);
  const loadingUi=await run(()=>({startupHidden:document.getElementById('startup-screen').hidden,detailHidden:document.getElementById('detail').hidden,animation:getComputedStyle(document.querySelector('#replay-loading .loading-spinner')).animationName,reduced:matchMedia('(prefers-reduced-motion:reduce)').matches}));
  check(loadingUi.startupHidden&&loadingUi.detailHidden&&(loadingUi.animation==='loading-spin'||loadingUi.reduced),`startup finishes and replay loader honors motion preference: ${JSON.stringify(loadingUi)}`);
  await capture('client-replay-loading.png');
  await wait(()=>run(()=>!document.getElementById('detail').hidden&&document.getElementById('player-grid').dataset.messages==='ready'),'Board/current decision failed to render');
  check(!apiReads.some(path=>/\/artifacts/.test(path)||/limit=25/.test(path)||/playerId=p[23]/.test(path)),'first board does not prefetch attachments, duplicate raw-message pages, or idle players');
  await run(()=>document.getElementById('open-observations').click());
  await wait(()=>run(()=>document.querySelector('#issued-list pre')?.textContent.includes('possibleColors')),'Raw issued observation did not load');
  check(await run(()=>{const raw=JSON.parse(document.querySelector('#issued-list pre').textContent);return raw.playerId==='p1'&&!raw.decisionToken&&raw.updates.length>0&&raw.view.hands.p1.every(c=>c.color===undefined);}), 'raw server observations preserve updates and hidden own cards without credentials');
  const issuedReadStart=apiReads.length;
  await run(()=>{const select=document.getElementById('issued-player');select.value='p2';select.dispatchEvent(new Event('change'));});
  await wait(()=>run(()=>document.querySelector('#issued-list pre')&&JSON.parse(document.querySelector('#issued-list pre').textContent).playerId==='p2'),'Raw observer seat switch failed');
  check(!apiReads.slice(issuedReadStart).some(path=>/\/messages|\/artifacts/.test(path)), 'raw observation monitor fetches server records without model messages or artifacts');
  await capture('client-issued-observations.png');
  await run(()=>{const select=document.getElementById('issued-player');select.value='p1';select.dispatchEvent(new Event('change'));});
  await run(()=>document.getElementById('open-agent-messages').click());
  await wait(()=>run(()=>document.querySelector('#monitor-messages pre')?.textContent.includes('model-input')),'Input audit failed to show the original model request');
  check(await run(()=>document.querySelectorAll('#monitor-messages details').length===1&&!document.getElementById('monitor-messages').textContent.includes('model-output')), 'input audit excludes model outputs and reasoning records');
  const undoMonitorMessage=fixture.appendMonitorMessage('p1',{messages:[{role:'system',content:'synthetic system prompt'},{role:'user',content:'new message with no game action <img src=x onerror="window.__thinkingXss=1">'}],tools:[]});
  await wait(()=>run(()=>document.querySelectorAll('#monitor-messages details').length===2),'Live input monitor stopped at the previous end of the stream');
  await run(()=>document.querySelector('#monitor-messages details').open=true);
  await wait(()=>run(()=>document.querySelector('#monitor-messages pre').textContent.includes('new message with no game action')),'New raw content did not appear');
  check(true,'live monitor reads messages uploaded after an empty tail without requiring a new game action');
  check(await run(()=>!window.__thinkingXss&&!document.querySelector('#monitor-messages img')), 'raw model inputs preserve system and user messages as safe text');
  await capture('client-agent-messages.png');
  const undoFragment0=fixture.appendMonitorMessage('p1',{role:'model-request',capture:{logicalId:'synthetic-fragment',fragment:true,index:0,count:2},dataBase64:'e30='});
  const undoFragment1=fixture.appendMonitorMessage('p1',{role:'model-request',capture:{logicalId:'synthetic-fragment',fragment:true,index:1,count:2},dataBase64:'e30='});
  await run(()=>document.getElementById('monitor-latest').click());
  await wait(()=>run(()=>document.querySelector('#monitor-messages pre')?.textContent.includes('synthetic-fragment')),'Latest fragmented input did not load');
  check(await run(()=>document.querySelectorAll('#monitor-messages details').length===2),'latest input starts from its first recorded fragment instead of dropping preceding fragments');
  await run(()=>{const select=document.getElementById('monitor-player');select.value='p2';select.dispatchEvent(new Event('change'));});
  await wait(()=>run(()=>document.getElementById('monitor-status').textContent.includes('暂无新消息')),'Empty seat message status did not render');
  check(await run(()=>document.querySelectorAll('#monitor-messages details').length===0),'switching seats clears previous private message content');
  await run(()=>document.getElementById('agent-messages-dialog').close());undoFragment1();undoFragment0();undoMonitorMessage();
  failDetail=true;await run(id=>{void selectEpisode(id);},fixture.id);
  await wait(()=>run(()=>document.getElementById('replay-loading').dataset.failed==='true'),'Failed replay did not show retry');
  check(await run(()=>!document.getElementById('retry-replay').hidden&&document.getElementById('detail').hidden),'failed replay has explicit error and retry, without stale cards');
  await run(()=>document.getElementById('retry-replay').click());
  await wait(()=>run(()=>!document.getElementById('detail').hidden&&document.getElementById('player-grid').dataset.messages==='ready'),'Replay retry did not recover');
  check(await run(()=>document.getElementById('replay-loading').hidden),'replay retry restores board');
  await wait(async()=>(await status()).phase==='connected','Recovered API was not revalidated after a successful retry');
  checks.push('successful retry revalidates identity and restores the green connection indicator');
  await wait(()=>run(()=>document.getElementById('recording-summary').textContent.includes('1/3')),'Per-seat recording summary failed to load');
  await run(()=>document.getElementById('recording-summary').click());
  check(await run(()=>document.getElementById('recording-dialog').open&&document.querySelector('[data-player=p1].recording-seat').textContent.includes('部分记录')&&document.querySelector('[data-player=p2].recording-seat').textContent.includes('暂无模型 / 工具消息')),'audit distinguishes sealed partial capture from missing seat messages');
  check(await run(()=>document.getElementById('recording-dialog').textContent.includes('不等于已核验全部内部思考')),'recording completeness is labelled as a client declaration');
  await run(()=>document.getElementById('recording-dialog').close());
  await run(()=>document.getElementById('open-evidence').click());
  await wait(() => run(() => document.getElementById('episode-title').textContent.includes('Hanabi') && document.getElementById('artifacts').querySelector('button') && document.getElementById('model-messages').textContent.includes('synthetic-ui-message')), 'On-demand messages/artifacts failed to render.');
  await run(() => { for (const detail of document.getElementById('model-messages').querySelectorAll('details')) detail.open = true; });
  await wait(() => run(() => document.getElementById('model-messages').textContent.includes('合成验收消息')), 'Original message text did not expand.');
  checks.push('original in-game message expands without rewriting');
  await run(()=>document.getElementById('evidence-dialog').close());
  await wait(() => run(() => document.getElementById('player-grid').dataset.messages === 'ready'), 'Focused per-seat message reads did not finish.');
  check(await run(()=>document.getElementById('hint-counter').textContent.includes('剩余提示 8 / 8')&&document.querySelectorAll('#hint-counter .hint-tokens i.available').length===8),'Hanabi shared hint pool displays remaining tokens and maximum');
  await run(()=>document.getElementById('open-rules').click());
  check(await run(()=>document.getElementById('rules-dialog').open&&document.getElementById('rules-dialog').textContent.includes('0 枚时不能提示')&&document.getElementById('rules-dialog').textContent.includes('最多 8 枚')),'game rules are directly available with hint costs and recovery limits');
  await capture('client-game-rules.png');await run(()=>document.getElementById('rules-dialog').close());
  const frames=(await fixture.call(`/rollouts/${fixture.id}`)).frames;
  await run(index=>{const timeline=document.getElementById('timeline');timeline.value=index;timeline.dispatchEvent(new Event('input'));},frames.findIndex(f=>f.kind==='accepted'&&f.action?.type==='discard'));
  check(await run(()=>document.getElementById('hint-counter').textContent.includes('剩余提示 7 / 8')),'historical pre-discard view shows the hint consumed by the previous player');
  await run(()=>{const timeline=document.getElementById('timeline');timeline.value=timeline.max;timeline.dispatchEvent(new Event('input'));});
  check(await run(()=>document.getElementById('hint-counter').textContent.includes('剩余提示 8 / 8')),'later view restores one shared hint after discard without changing earlier frames');
  await run(index => {document.getElementById('timeline').value=index;document.getElementById('timeline').dispatchEvent(new Event('input'));document.getElementById('message').hidden=true;},frames.findIndex(f=>f.kind==='accepted'&&f.action?.type==='play'));
  check(await run(() => document.querySelectorAll('.player-panel').length===3 && document.querySelector('.acting .thinking-excerpt').textContent.includes('合成布局测试') && !window.__thinkingXss),'three synchronized player columns show linked reasoning as safe text');
  const layout=[];
  for(const [width,height] of [[1440,900],[1280,800]]){
    window.setContentSize(width,height);
    await run(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const measured=await run(()=>{
      const inside=(parent,child)=>{const p=parent.getBoundingClientRect(),c=child.getBoundingClientRect();return c.top>=p.top-1&&c.bottom<=p.bottom+1&&c.right<=p.right+1;};
      return {width:innerWidth,height:innerHeight,pageFits:document.documentElement.scrollHeight<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth+1,
        panels:[...document.querySelectorAll('.player-panel')].map(p=>({heights:[...p.children].map(e=>({name:e.className,height:e.getBoundingClientRect().height,bottom:e.getBoundingClientRect().bottom})),panel:p.getBoundingClientRect().toJSON(),actionFits:inside(p,p.querySelector('.player-action'))&&p.querySelector('.action-description').clientHeight>=20,handFits:inside(p,p.querySelector('.audit-hand')),thoughtFont:parseFloat(getComputedStyle(p.querySelector('.thinking-excerpt')).fontSize),thoughtHeight:p.querySelector('.thinking-excerpt').clientHeight})),
        timelineFits:document.querySelector('.replay-panel').getBoundingClientRect().bottom<=innerHeight+1};
    });
    layout.push(measured);await capture(`replay-${width}x${height}.png`);
    writeFileSync(join(dataDir,'replay-layout.json'),JSON.stringify(layout,null,2));
    check(measured.pageFits&&measured.timelineFits&&measured.panels.every(p=>p.actionFits&&p.handFits&&p.thoughtFont>=15&&p.thoughtHeight>=24),`player hands, reasoning and actions fit ${width}x${height} without page scrolling`);
  }
  await run(()=>document.querySelector('.acting .player-decision .text-button').click());
  check(await run(()=>document.getElementById('decision-dialog').open&&document.getElementById('decision-dialog').textContent.includes('原文结束标记')&&!document.getElementById('decision-dialog').querySelector('img')),'full decision dialog preserves long original reasoning and does not execute uploaded markup');
  await run(()=>document.getElementById('decision-dialog').close());
  check(await run(() => Number(document.getElementById('timeline').max) >= 2), 'recorded timeline renders');
  check(await run(() => !window.__smokeXss && !document.getElementById('annotations').querySelector('img')), 'untrusted annotation rendered as text');
  await run(() => document.getElementById('previous').click());
  check(await run(() => Number(document.getElementById('timeline').value) < Number(document.getElementById('timeline').max)), 'historical frame navigation');
  await run(() => document.getElementById('verify-replay').click());
  await wait(() => run(() => document.getElementById('verification-result').textContent.includes('synthetic-no-engine')), 'Replay UI failed.');
  checks.push('remote replay response renders (synthetic status only; engine not tested)');
  await run(() => document.querySelector('[data-download-artifact]').click());
  await wait(() => Promise.resolve(existsSync(join(dataDir, fixture.artifact.name))), 'Attachment was not downloaded.');
  await wait(() => {try{return readFileSync(join(dataDir,fixture.artifact.name)).equals(fixture.bytes);}catch(error){if(['ENOENT','EBUSY','EPERM'].includes(error.code))return false;throw error;}}, 'Downloaded attachment differs.');
  check(artifactAttempts.length>=2&&artifactAttempts.slice(1).every(at=>at>=artifactRetryAt),'artifact download honors server Retry-After across packaged IPC before retrying');
  checks.push('attachment download preserves exact bytes and SHA-256');
  await run(() => document.getElementById('copy-api').click());
  await wait(() => Promise.resolve(getCopied() === fixture.apiUrl), 'Copy API bridge failed.');
  checks.push('copy API bridge');
  await run(()=>document.getElementById('open-create').click());
  await run(()=>document.getElementById('create-room').click());
  await wait(()=>run(()=>!document.getElementById('room-panel').hidden&&document.getElementById('room-panel').textContent.includes('复制邀请链接')),'Admin invitation room did not appear');
  await run(()=>[...document.querySelectorAll('#room-panel button')].find(b=>b.textContent==='复制邀请链接').click());
  await wait(()=>Promise.resolve(getCopied()?.startsWith('coopbench://join#')),'Admin invitation copy failed');
  check(await run(()=>document.getElementById('room-panel').textContent.includes('180 秒')&&[...document.querySelectorAll('#room-panel button')].find(b=>b.textContent==='开始游戏').disabled),'admin creates a three-minute invitation room and prevents starting without ready seats');
  await run(()=>document.getElementById('create-dialog').close());
  let screenshot;
  try { const picture = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); assert.ok(!picture.isEmpty()); writeFileSync(join(dataDir, 'client-audit.png'), picture.toPNG()); screenshot = { saved: true }; }
  catch (error) { screenshot = { saved: false, error: String(error) }; }
  await capture('client-connection-success.png');
  await run(() => {
    document.getElementById('open-create').click();
    document.getElementById('create-participation').value='agent';document.getElementById('create-participation').dispatchEvent(new Event('change'));
    const game = document.getElementById('create-game'); game.value = 'hanabi'; game.dispatchEvent(new Event('change'));
    document.getElementById('create-players').value = '3'; document.getElementById('create-form').requestSubmit();
  });
  await wait(() => run(() => document.getElementById('seat-list').querySelectorAll('button').length === 3), 'Create game/seat configs failed.');
  check(await run(() => document.getElementById('seat-list').textContent.includes('p1')), 'three private player connection configs rendered');
  await run(() => document.getElementById('seat-list').querySelector('button').click());
  await wait(() => Promise.resolve(getCopied()?.includes('seatToken')), 'Copy seat config failed.');
  const copied = JSON.parse(getCopied()); check(copied.baseUrl === fixture.apiUrl && copied.episodeId !== fixture.id && typeof copied.seatToken === 'string' && copied.gameId==='hanabi' && copied.scenarioId==='base' && copied.playerId==='p1', 'seat config copies current API, episode, game, scenario and own player');
  await fixture.call(`/episodes/${copied.episodeId}/truncate`, fixture.adminToken, { reason: 'synthetic UI-created episode cleanup' });
  await run(()=>{document.getElementById('open-create').click();document.getElementById('create-participation').value='invite';document.getElementById('create-participation').dispatchEvent(new Event('change'));document.getElementById('create-room').click();});
  await wait(()=>run(()=>!document.getElementById('create-room').disabled),'Invitation creation did not finish.');
  await wait(()=>run(()=>!document.getElementById('room-panel').hidden&&document.getElementById('room-panel').textContent.includes('复制邀请链接')),'Invitation room did not render.');
  await run(()=>[...document.getElementById('room-panel').querySelectorAll('button')].find(b=>b.textContent.includes('邀请')).click());
  await wait(()=>Promise.resolve(getCopied()?.startsWith('coopbench://join#')),'Invitation was not copied.');
  const invitationParams=new URLSearchParams(new URL(getCopied()).hash.slice(1));
  const createdRoom=await fixture.call(`/rooms/${invitationParams.get('room')}/admin`);
  check(createdRoom.status==='waiting'&&createdRoom.episodeId===null&&!('seats' in createdRoom),'operator creates a pre-deal room and copies an invitation without player credentials');
  await run(()=>{
    document.getElementById('create-dialog').close();document.getElementById('open-create').click();
    document.getElementById('create-players').value='2';
    document.getElementById('create-name').value='  周日花火练习 <b>一起玩</b>  ';
    document.getElementById('create-participation').value='human';document.getElementById('create-participation').dispatchEvent(new Event('change'));
    document.getElementById('create-form').requestSubmit();
  });
  await wait(()=>run(()=>!document.getElementById('create-room').disabled),'Human creation did not finish.');
  await wait(()=>run(()=>document.getElementById('room-panel').textContent.includes('已开放大厅')),'Human room creation did not appear.');
  await run(()=>document.querySelector('#room-panel button[data-seat="p1"][data-action="token"]').click());
  await wait(()=>Promise.resolve(getCopied()&&!getCopied().startsWith('coopbench:')),'Creator did not copy the issued seat key.');
  const issuedFirst=getCopied();
  await run(()=>document.querySelector('#room-panel button[data-seat="p2"][data-action="token"]').click());
  await wait(()=>Promise.resolve(getCopied()!==issuedFirst),'Creator did not copy the second seat key.');
  const issuedSecond=getCopied();
  const publicRooms=(await fixture.call('/lobby')).rooms,humanRoom=publicRooms.at(-1);
  check(!JSON.stringify(publicRooms).includes(issuedFirst),'lobby never exposes issued seat keys');
  check(await run(()=>document.getElementById('start-room').disabled&&getComputedStyle(document.getElementById('start-room')).cursor==='default'),'incomplete room has gray start button and normal cursor');
  await capture('client-room-waiting.png');
  check(humanRoom.name==='周日花火练习 <b>一起玩</b>','room name is trimmed and sent at creation');
  check(Boolean(humanRoom)&&!(await fixture.call('/lobby')).rooms.some(r=>r.roomId===createdRoom.roomId),'lobby excludes invitation-only rooms');
  await run(()=>{document.getElementById('create-dialog').close();document.getElementById('open-join').click();});
  await wait(()=>run(()=>document.querySelectorAll('#joinable-rooms button[data-room-id]').length>0),'Joinable lobby rooms did not render.');
  await capture('client-lobby.png');
  check(await run(()=>document.getElementById('joinable-rooms').textContent.includes('周日花火练习 <b>一起玩</b>')&&!document.querySelector('#joinable-rooms b')),'lobby room names are displayed as inert text');
  const joinHuman=async()=>{
    await run(id=>{document.querySelector(`#joinable-rooms button[data-room-id="${id}"]`).click();document.getElementById('lobby-player-name').value='Synthetic lobby human';},humanRoom.roomId);
    check(!player.runtime,'clicking a room does not claim a seat without its token');
    await run(()=>document.getElementById('join-seat').click());
    check(!player.runtime,'blank seat token cannot claim a seat');
    check(await run(()=>!document.getElementById('generate-seat-token')),'players cannot generate their own seat keys');
    await run(()=>{document.getElementById('lobby-seat-token').value='x'.repeat(43);document.getElementById('join-seat').click();});
    await wait(()=>run(()=>!document.getElementById('join-seat').disabled&&document.getElementById('join-status').textContent.includes('无效')),'Unissued seat key was not rejected.');
    check(!player.runtime,'a syntactically valid but unissued key cannot take a seat');
    await run(key=>{document.getElementById('lobby-seat-token').value=key;document.getElementById('join-seat').click();},issuedFirst);
    await wait(()=>Promise.resolve(player.window&&!player.window.isDestroyed()&&player.runtime?.room),'Human player window did not open.');
    check(await run(()=>!document.getElementById('lobby-seat-token').value),'seat token field clears after joining');
  };
  await joinHuman();
  const seatJs=code=>player.window.webContents.executeJavaScript(code,true);
  await wait(()=>seatJs("!document.querySelector('#lobby').hidden"),'Human waiting room did not render.');
  check(await seatJs("document.querySelector('#game-name').textContent==='周日花火练习 <b>一起玩</b>'"),'joined player sees the room name');
  check(await seatJs("!window.coopDesktop && Boolean(window.coopPlayer)"),'integrated player window cannot access the account/audit bridge');
  check(!JSON.stringify(await seatJs("window.coopPlayer.command('status')")).includes(player.credentials.playerToken),'player renderer never receives seat credentials');
  await seatJs("document.querySelector('#leave-room').click()");
  await wait(()=>Promise.resolve(!player.runtime),'Leaving waiting room did not stop runtime.');
  check((await fixture.call('/lobby')).rooms.find(r=>r.roomId===humanRoom.roomId).members.length===0,'leaving releases the lobby seat');
  await run(()=>document.getElementById('open-join').click());
  await wait(()=>run(()=>document.querySelectorAll('#joinable-rooms button[data-room-id]').length>0),'Lobby did not reopen.');
  await joinHuman();
  const otherToken=issuedSecond;
  const other=await fixture.call(`/rooms/${humanRoom.roomId}/join`,otherToken,{name:'Synthetic teammate',playerToken:otherToken});
  await wait(()=>seatJs("document.querySelector('#members').textContent.includes('Synthetic teammate')"),'Player did not receive roster update.');
  await fixture.call(`/rooms/${humanRoom.roomId}/ready`,otherToken,{ready:true,rosterVersion:other.rosterVersion});
  check(await seatJs("document.querySelector('#ready').hidden"),'human seat confirms readiness automatically when the roster fills');
  check(await seatJs("document.querySelector('#start').hidden"),'human seat has no host start control');
  await run(id=>{document.getElementById('manage-rooms').click();},humanRoom.roomId);
  await wait(()=>run(()=>[...document.querySelectorAll('#room-panel button')].some(b=>b.textContent.includes('周日花火练习'))),'Manage rooms did not list the created room.');
  await run(()=>[...document.querySelectorAll('#room-panel button')].find(b=>b.textContent.includes('周日花火练习')).click());
  await wait(()=>run(()=>document.getElementById('start-room')&&!document.getElementById('start-room').disabled),'Full ready roster did not enable creator start.');
  check(await run(()=>document.getElementById('room-panel').textContent.includes('Synthetic teammate') && getComputedStyle(document.getElementById('start-room')).cursor!=='wait'), 'creator sees joined members and start button uses a normal cursor');
  await capture('client-room-ready.png');
  await run(()=>document.getElementById('start-room').click());
  await wait(()=>run(()=>document.getElementById('room-open-replay')),'Creator start did not finish.');
  await wait(()=>run(()=>!document.getElementById('message').hidden&&document.getElementById('message').textContent.includes('游戏已开始。')),'Start success toast did not appear.');
  await wait(()=>run(()=>document.getElementById('message').hidden),'Start success toast did not dismiss itself.');
  check(true,'room-start success notice automatically disappears');
  await run(()=>document.getElementById('create-dialog').close());
  await run(()=>{message('Synthetic success before a newer error');message('Synthetic actionable error',true);});
  await new Promise(resolve=>setTimeout(resolve,4200));
  check(await run(()=>!document.getElementById('message').hidden&&document.getElementById('message').textContent.includes('Synthetic actionable error')),'older success timer does not erase a newer error');
  await run(()=>document.querySelector('#message .notice-dismiss').click());
  check(await run(()=>document.getElementById('message').hidden),'notifications can be dismissed immediately');
  await run(()=>{message('Synthetic notice before navigation');window.CoopLobby.home();});
  check(await run(()=>document.getElementById('message').hidden),'page navigation clears stale notices');
  await wait(()=>seatJs("!document.querySelector('#game').hidden"),'Started human game did not render.');
  check(await seatJs("[...document.querySelector('.player-hand').querySelectorAll('.card-face strong')].every(card=>card.textContent==='?')"),'human board retains own hidden cards');
  await seatJs("document.querySelector('.card[data-player=p2][data-index=\"0\"]').click();document.querySelector('[data-choice=color]').click()");
  check(await seatJs("document.querySelectorAll('.card.card-preview').length===2&&!document.querySelector('#manual-actions')&&!document.querySelector('#observation')&&document.querySelector('#turn-label').textContent==='轮到你了'"),'human card click previews every matching card alongside the turn countdown without raw diagnostic controls');
  await seatJs("document.querySelector('#confirm-card-action').click()");
  await wait(()=>seatJs("document.querySelectorAll('.hint-counter .token-dot.filled').length===7"),'Human action was not reflected by runtime.');
  await seatJs('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const picture=await player.window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});writeFileSync(join(dataDir,'client-human-game.png'),picture.toPNG());
  const episode=player.runtime.room.episodeId,playerId=player.runtime.room.playerId;
  check((await fixture.call(`/rollouts/${episode}`)).summary.name===humanRoom.name,'started room retains its name in saved records');
  await seatJs("document.querySelector('#disconnect').click()");await wait(()=>Promise.resolve(!player.runtime),'Disconnect did not finish.');
  await run(async roomId=>{try{await window.coopTransport.openPlayer({roomId,name:'Mistyped key',seatToken:'z'.repeat(43)});throw Error('Invalid active-seat key unexpectedly accepted');}catch(error){if(error.message==='Invalid active-seat key unexpectedly accepted')throw error;}},humanRoom.roomId);
  check(player.credentials.playerToken===issuedFirst,'rejected pasted key preserves the previous recoverable seat');
  await run(()=>document.getElementById('open-join').click());
  await wait(()=>run(id=>Boolean(document.querySelector(`#my-participating-rooms [data-room-id="${id}"] button`)),humanRoom.roomId),'Account participation missing');
  await run(id=>document.querySelector(`#my-participating-rooms [data-room-id="${id}"] button`).click(),humanRoom.roomId);
  await wait(()=>Promise.resolve(player.runtime?.room?.episodeId===episode),'Return to an active human seat failed.');
  check(player.runtime.room.playerId===playerId,'returning to a started game restores the same private seat');
  await run(()=>{document.getElementById('open-library').click();document.getElementById('refresh').click();});
  await wait(()=>run(id=>Boolean(document.querySelector(`[data-episode="${id}"]`)),episode),'Active game missing from replay block.');
  await run(id=>document.querySelector(`[data-episode="${id}"]`).click(),episode);
  await wait(()=>run(()=>!document.getElementById('detail').hidden),'Active game replay did not open.');
  check(await run(()=>document.getElementById('outcome-badge').textContent.includes('进行中')),'ongoing games can be replayed before completion');
  await fixture.call(`/episodes/${episode}/truncate`,fixture.adminToken,{reason:'synthetic lobby test complete'});
  await player.close();
  await run(()=>{document.getElementById('join-dialog').close();document.getElementById('open-library').click();document.getElementById('refresh').click();});
  await wait(()=>run(id=>Boolean(document.querySelector(`[data-episode="${id}"]`)),episode),'Named game did not appear in records.');
  check(await run(id=>document.querySelector(`[data-episode="${id}"]`).textContent.includes('周日花火练习 <b>一起玩</b>'),episode),'records display the saved room name');
  await run(id=>{document.querySelector(`[data-episode="${id}"]`).click();document.getElementById('library-dialog').close();},episode);
  await wait(()=>run(()=>document.getElementById('episode-title').textContent==='周日花火练习 <b>一起玩</b>'),'Replay title lost the room name.');
  checks.push('named rooms remain named in the lobby, player, saved records and replay');
  checks.push('packaged lobby creates, discovers, joins, leaves, readies, starts and accepts a human action');
  await run(()=>{document.getElementById('open-create').click();document.getElementById('create-participation').value='human';document.getElementById('create-participation').dispatchEvent(new Event('change'));document.getElementById('create-name').value='内置 Agent 混合入席';document.getElementById('create-players').value='2';document.getElementById('create-room').click();});
  await wait(()=>run(()=>document.querySelectorAll('.host-seat.vacant').length===2),'Vacant host seats missing.');
  check(await run(()=>[...document.querySelectorAll('.host-seat')].every(c=>[...c.querySelectorAll('button')].map(b=>b.dataset.action).join(',')==='claude,agent,token')),'empty seats expose exactly prompt, built-in agent and token buttons');
  await run(()=>document.querySelector('[data-seat="p1"][data-action="claude"]').click());
  await wait(()=>Promise.resolve(getCopied()?.includes('玩家专用说明文档')),'Claude prompt not copied.');
  const prompt=getCopied(),agentRoomId=prompt.match(/roomId: ([a-f0-9-]{36})/)[1],originalKey=prompt.match(/seat token: ([A-Za-z0-9_-]+)/)[1];
  check(prompt.includes(fixture.baseUrl+'/player.md')&&prompt.includes('playerId: p1')&&!prompt.includes(fixture.adminToken),'Claude prompt carries exactly its own seat and same-origin player guide without organizer credentials');
  await capture('client-host-empty-seats.png');
  let modelLaunches=0;
  const launchModel=async()=>{
    await run(()=>document.querySelector('[data-seat="p1"][data-action="agent"]').click());
    await wait(()=>run(()=>document.querySelector('#host-agent-dialog')?.dataset.loaded==='true'),'Model configuration did not load.');
    if(modelLaunches++===0){
      check(await run(()=>document.getElementById('host-agent-url').value==='https://api.deepseek.com'&&document.getElementById('host-agent-model').value==='deepseek-flash'&&document.getElementById('host-agent-start').disabled),'built-in agent defaults to DeepSeek and cannot join before verification');
      await run(base=>{document.getElementById('host-agent-url').value=base+'/model';document.getElementById('host-agent-model').value='synthetic-thinking-model';document.getElementById('host-agent-key').value='synthetic-wrong-key';document.getElementById('host-agent-test').click();},fixture.baseUrl);
      await wait(()=>run(()=>document.getElementById('host-agent-error').textContent.includes('HTTP 401')),'Invalid provider key did not explain failure.');
      check(await run(()=>document.getElementById('host-agent-start').disabled&&Boolean(document.querySelector('.host-seat[data-player-id="p1"].vacant'))),'failed model verification leaves the seat vacant');
    }else if(remote.store.encryption.isEncryptionAvailable()){
      check(await run(()=>document.getElementById('host-agent-key').value===''&&document.getElementById('host-agent-key').placeholder.includes('已加密保存')),'saved model key is reused without returning its plaintext to the renderer');
      check(!readFileSync(hostSeats.modelFile()).includes(Buffer.from('synthetic-provider-key')),'native model credential file is encrypted');
    }
    await run(base=>{document.getElementById('host-agent-url').value=base+'/model';document.getElementById('host-agent-model').value='synthetic-thinking-model';if(!document.getElementById('host-agent-key').placeholder.includes('已加密保存'))document.getElementById('host-agent-key').value='synthetic-provider-key';document.getElementById('host-agent-test').click();},fixture.baseUrl);
    await wait(()=>run(()=>!document.getElementById('host-agent-start').disabled),'Model tool verification did not pass.');
    if(modelLaunches===1)await capture('client-host-model-verified.png');
    await run(()=>document.getElementById('host-agent-start').click());
    await wait(()=>run(()=>document.querySelector('.host-seat[data-player-id="p1"].occupied')&&!document.querySelector('#host-agent-dialog')),'Built-in agent failed to occupy its seat.');
    check(await run(()=>!document.getElementById('host-agent-key')&&document.querySelector('.host-seat[data-player-id="p1"]').querySelectorAll('button').length===1&&document.querySelector('.host-seat[data-player-id="p1"] button').dataset.action==='kick'),'occupied seat only exposes kick and provider secret is cleared from UI');
  };
  await launchModel();
  await run(()=>document.querySelector('[data-seat="p1"][data-action="kick"]').click());
  await wait(()=>Promise.resolve(hostSeats.agents.size===0),'Kicking did not stop the local agent.');
  await wait(()=>run(()=>document.querySelector('.host-seat[data-player-id="p1"].vacant')),'Kicked seat did not become vacant.');
  const revoked=await fetch(fixture.apiUrl+`/rooms/${agentRoomId}`,{headers:{Authorization:`Bearer ${originalKey}`}});check(revoked.status===401,'kicked built-in agent loses its seat credential');
  await launchModel();
  const another=(await hostSeats.key({roomId:agentRoomId,playerId:'p2'})).seatToken;
  const teammate=await fixture.call(`/rooms/${agentRoomId}/join`,another,{name:'External API player',playerToken:another});
  await fixture.call(`/rooms/${agentRoomId}/ready`,another,{ready:true,rosterVersion:teammate.rosterVersion});
  await wait(()=>run(()=>document.querySelector('#start-room')&&!document.querySelector('#start-room').disabled),'Built-in agent did not automatically ready with a complete roster.');
  await capture('client-host-agent-ready.png');
  await run(()=>document.querySelector('#start-room').click());
  await wait(()=>Promise.resolve(fixture.requests.some(r=>r.path==='/model/responses'&&r.body.tools[0]?.name==='act')),'Built-in harness did not call the Responses API.');
  const builtInEpisode=(await fixture.call(`/rooms/${agentRoomId}/admin`)).episodeId;
  await wait(()=>Promise.resolve(fixture.requests.some(r=>r.path===`/api/v1/episodes/${builtInEpisode}/actions`)),'Built-in harness did not submit a model action.');
  const modelRequest=fixture.requests.find(r=>r.path==='/model/responses'&&r.body.tools[0]?.name==='act');check(!JSON.stringify(modelRequest).includes(another)&&!JSON.stringify(modelRequest).includes(fixture.adminToken),'provider receives only seat context, not teammate or organizer credentials');
  check(!('tool_choice' in modelRequest.body),'packaged thinking harness omits incompatible tool_choice');
  await wait(()=>run(()=>document.querySelector('.host-agent-status')?.textContent.includes('HTTP 401')),'Active room did not display the provider failure.');
  check(await run(()=>document.querySelector('.host-agent-status').textContent.includes('API key')),'active host page refreshes and explains model errors');
  check(await run(()=>document.querySelector('.host-agent-status').textContent.includes('停止自动调用')),'failed agent stops instead of silently waiting or flooding the provider');
  await capture('client-host-model-error.png');
  check(await run(()=>document.querySelectorAll('#room-panel [data-action="kick"]').length===0),'started rooms never expose kick');
  const priorAgent=hostSeats.agents.get(agentRoomId+'/p1').runtime,priorContext=priorAgent.get('strategy:responsesHistory'),priorToken=priorAgent.credentials().playerToken;
  await wait(()=>run(()=>Boolean(document.querySelector('[data-action="resume-agent"]'))),'Failed Agent has no recovery control');
  await run(()=>document.querySelector('[data-action="resume-agent"]').click());
  await wait(()=>run(()=>document.querySelector('#host-agent-dialog')?.dataset.loaded==='true'),'Recovery model configuration did not load');
  await run(()=>{document.getElementById('host-agent-model').value='synthetic-recovered-model';document.getElementById('host-agent-key').value='synthetic-provider-key';document.getElementById('host-agent-test').click();});
  await wait(()=>run(()=>!document.getElementById('host-agent-start').disabled),'Recovery model preflight failed');
  await run(()=>document.getElementById('host-agent-start').click());
  await wait(()=>Promise.resolve(hostSeats.agents.get(agentRoomId+'/p1')?.runtime!==priorAgent&&!hostSeats.pending.size),'Agent recovery did not finish');
  const recovered=hostSeats.agents.get(agentRoomId+'/p1').runtime;
  check(recovered.credentials().playerToken===priorToken,'Agent recovery preserves the original seat token');
  check(priorContext?.length>0&&JSON.stringify(recovered.get('strategy:responsesHistory')).includes(JSON.stringify(priorContext[0])),'Agent recovery preserves the durable model conversation');
  check((await hostSeats.key({roomId:agentRoomId,playerId:'p1'})).seatToken===priorToken,'copying an active occupied seat retains its existing token');
  await run(()=>document.getElementById('end-room').click());
  check(await run(()=>document.querySelector('#confirm-end-room').closest('dialog').open),'host termination requires an explicit confirmation');
  await run(()=>document.getElementById('confirm-end-room').click());
  await wait(async()=>(await fixture.call(`/rooms/${agentRoomId}/admin`)).status==='truncated','Host termination failed');
  check((await fixture.call(`/rollouts/${builtInEpisode}/messages?playerId=p1`)).messages.length>0,'host termination keeps original agent messages');
  await hostSeats.close();
  await run(()=>document.querySelector('#create-dialog').close());
  checks.push('packaged host prompt, built-in model harness, token copy, kick, revoked key, rejoin, ready and action verified');
  if (remote.store.encryption.isEncryptionAvailable()) {
    const sessionKey=remote.token;await remote.connect({ apiUrl: fixture.apiUrl, token: sessionKey, remember: true });
    const saved = readFileSync(join(dataDir, 'remote-connection.json'), 'utf8');
    check(saved.includes('encrypted') && !saved.includes(fixture.adminToken) && remote.store.load().token === sessionKey, 'native secure storage encrypts and restores a server-bound credential');
  } else checks.push('native secure storage unavailable on this test host; persistence remains disabled');
  await run(() => document.getElementById('settings-open').click());
  await wait(() => run(() => !document.getElementById('password-form').hidden && !document.getElementById('new-password').disabled), 'Password setup did not become available.');
  await run(()=>document.getElementById('check-update').click());
  await wait(()=>run(()=>document.getElementById('update-status').textContent.includes('发现新版本')),'Update check UI failed.');
  await run(()=>document.getElementById('download-update').click());
  await wait(()=>run(()=>document.getElementById('update-status').textContent.includes('SHA-256 校验通过')),'Update download UI failed.');
  await capture('client-update-ready.png');await run(()=>document.getElementById('install-update').click());
  await wait(()=>Promise.resolve(fixture.updateOpened()),'Verified installer was not handed to the synthetic opener.');
  checks.push('settings uses the real update network stack across an HTTP 302, verifies bytes and opens only the synthetic installer');
  const syntheticPassword = '  合作bench Ａa9! password  ';
  await run(password => {
    document.getElementById('current-password').value='Synthetic registration password 7!';document.getElementById('new-password').value = password;
    document.getElementById('new-password').dispatchEvent(new Event('input'));
    document.getElementById('show-new-password').click();
    if(document.getElementById('new-password').type!=='text'||!document.getElementById('hint-new-password').textContent.includes('首尾空格'))throw Error('Password input diagnostics failed.');
    document.getElementById('confirm-password').value = password;
    document.getElementById('password-form').requestSubmit();
  }, syntheticPassword);
  await wait(() => Promise.resolve(remote.token.startsWith('hs1_')), 'Password setup did not create a human session.');
  await wait(() => run(() => !document.getElementById('save-password').disabled), 'Password setup did not finish.');
  check(await run(() => ['new-password', 'current-password', 'confirm-password'].every(id => !document.getElementById(id).value)), 'password setup clears all secret input fields');
  check(!readFileSync(join(dataDir, 'remote-connection.json'), 'utf8').includes(syntheticPassword), 'account password is never saved in client config');
  await capture('client-settings-password.png');
  await run(() => { document.getElementById('settings-close').click(); document.getElementById('disconnect').click(); });
  await wait(() => Promise.resolve(!remote.descriptor().connected), 'Session logout did not finish.');
  await run((password,apiUrl)=>{
    document.getElementById('password-mode').click();document.getElementById('api-address').value=apiUrl;
    document.getElementById('login-user-id').value='owner';document.getElementById('login-password').value=password.trim();document.getElementById('login-form').requestSubmit();
  },syntheticPassword,fixture.apiUrl);
  await wait(async()=>['expired','failed'].includes((await status()).phase),'Changed password bytes should not log in.');
  check(red(await status())&&(await status()).reason.includes('账号或密码不匹配'),'wrong password is distinguished from network failure and does not turn connection green');
  await run((password, apiUrl) => {
    document.getElementById('password-mode').click(); document.getElementById('api-address').value = apiUrl;
    document.getElementById('login-user-id').value = 'owner'; document.getElementById('login-password').value = password;
    document.getElementById('login-form').requestSubmit();
  }, syntheticPassword, fixture.apiUrl);
  await wait(async () => (await status()).phase === 'connected', 'Account/password login failed.');
  check(await run(() => !document.getElementById('login-password').value), 'password login succeeds through packaged preload and clears the password');
  check(await run(async url => { try { await fetch(url); return false; } catch { return true; } }, fixture.apiUrl + '/health'), 'CSP blocks direct renderer network access');
  // All API/audit checks finish before shutdown. Test a real connection loss,
  // then verify logout can clear credentials and cached data while offline.
  await fixture.close(); // Mock close is idempotent; main may close again.
  await run(() => document.getElementById('check-connection').click());
  await wait(async () => (await status()).phase === 'disconnected', 'Manual check after fixture shutdown did not report a disconnected API.');
  const disconnected = await status();
  check(red(disconnected) && disconnected.label === '连接已断开' && !disconnected.reason.includes('凭证无效'), 'manual check after server shutdown replaces green with red and does not blame the credential');
  await capture('client-connection-server-offline.png');
  await run(() => document.getElementById('disconnect').click());
  await wait(() => run(() => document.getElementById('disconnect').hidden && !document.getElementById('seat-list').textContent && !document.getElementById('model-messages').textContent), 'Logout did not clear captured data.');
  check(!remote.descriptor().connected && !readFileSync(join(dataDir, 'remote-connection.json'), 'utf8').includes('encrypted'), 'logout clears credential and saved secret');
  return { ok: true, at: new Date().toISOString(), backend:'mock', fixture:'scripted synthetic loopback HTTP API; no game engine, database, production data or model calls', games:1, checks, screenshot, screenshots };
}
