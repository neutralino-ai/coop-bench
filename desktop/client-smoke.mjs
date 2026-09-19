// Isolated synthetic UI acceptance data. Never connects to the production service.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import {externalSmokeFixture} from './pg-smoke-fixture.mjs';

export async function startClientFixture(dataDir) {
  const { startLocalApp } = await import('../runtime/coop-bench/src/server.mjs');
  const external=externalSmokeFixture(),personalToken = external?.adminToken??'synthetic-owner-' + randomUUID();
  const usersFile = join(dataDir, 'synthetic-access-users.json');
  writeFileSync(usersFile, JSON.stringify({ version: 1, users: [{ id: 'owner', role: 'operator', disabled: false,
    tokenHash: createHash('sha256').update(personalToken).digest('hex') }] }), { mode: 0o600 });
  const local = external??await startLocalApp({ dataDir: join(dataDir, 'synthetic-api'), port: 0, serveWeb: false,
    usersFile, trustedProxyOrigin: 'https://synthetic.example.test' });
  local.adminToken = personalToken; // All human fixture calls use a real individual account.
  const call = async (path, token = local.adminToken, body, key) => {
    const response = await fetch(local.apiUrl + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json(); assert.ok(response.ok, `Fixture HTTP ${response.status}: ${JSON.stringify(value)}`); return value;
  };
  const created = await call('/episodes', local.adminToken, { gameId: 'hanabi', scenarioId: 'base', playerCount: 3 });
  const id = created.episodeId, seat = created.seats[0].token;
  await call(`/episodes/${id}/messages`, seat, { sequence: 0, messageId: 'synthetic-ui-message', kind: 'model-input', message: { role: 'user', content: '合成验收消息：仅用于测试客户端，不是模型实局轨迹。' } });
  const observation = await call(`/episodes/${id}/observation`, seat);
  await call(`/episodes/${id}/messages`, seat, { sequence: 1, messageId: 'synthetic-linked-reasoning', kind: 'model-output', observationId: observation.observationId, reasoningAvailability: 'provided', message: {role:'assistant',reasoning_content:'合成布局测试：这是用于检验长文本展示的虚构内容，没有调用真实模型。'.repeat(25)+'原文结束标记', content:'<img src=x onerror="window.__thinkingXss=1">'} });
  await call(`/episodes/${id}/actions`, seat, { observationId: observation.observationId, decisionToken: observation.decisionToken, action: { type: 'play', index: 0 }, decisionSummary: '合成测试动作，不是模型推理。' }, randomUUID());
  for(const [index,action] of [[1,{type:'hint',target:'p3',kind:'value',value:1}],[2,{type:'discard',index:0}]]){
    const token=created.seats[index].token,view=await call(`/episodes/${id}/observation`,token);
    await call(`/episodes/${id}/actions`,token,{observationId:view.observationId,decisionToken:view.decisionToken,action},randomUUID());
  }
  await call(`/episodes/${id}/truncate`, local.adminToken, { reason: 'synthetic-desktop-client-acceptance' });
  await call(`/episodes/${id}/messages/complete`, seat, { completeness: 'partial', reasoningAvailability: 'not-provided', scope: 'Synthetic UI fixture only', unavailable: ['No real model was invoked.'] });
  const bytes = Buffer.from('合成桌面附件\n{"fixture":true,"modelInvoked":false}\n');
  const artifact = await call(`/episodes/${id}/artifacts`, seat, { name: 'synthetic-client-artifact.jsonl', mediaType: 'application/x-ndjson', kind: 'agent-trace', byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), reasoningAvailability: 'not-provided' }, randomUUID());
  await call(`/episodes/${id}/artifacts/${artifact.id}/chunks`, seat, { index: 0, dataBase64: bytes.toString('base64') });
  await call(`/episodes/${id}/artifacts/${artifact.id}/complete`, seat, {});
  await call(`/rollouts/${id}/annotations`, local.adminToken, { kind: 'review', text: '合成 UI 审计 <img src=x onerror="window.__smokeXss=1">' });
  assert.equal((await fetch(local.baseUrl + '/')).status, 404);
  const updateBytes=Buffer.from('Synthetic updater fixture; never execute.'),updateDigest=createHash('sha256').update(updateBytes).digest('hex');
  const updateSuffix=process.platform==='darwin'?`mac-${process.arch}.dmg`:'win-x64.exe',updateName=`Coop-Bench-99.0.0-${updateSuffix}`;
  let updateOpened=false;
  const updateServer=createServer((req,res)=>{
    if(req.url==='/release'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({tag_name:'v99.0.0',draft:false,prerelease:false,html_url:'https://github.com/neutralino-ai/coop-bench/releases/tag/v99.0.0',assets:[{name:updateName,size:updateBytes.length,digest:`sha256:${updateDigest}`,browser_download_url:`https://github.com/neutralino-ai/coop-bench/releases/download/v99.0.0/${updateName}`}]}));}
    else if(req.url==='/redirect'){res.writeHead(302,{Location:'https://release-assets.githubusercontent.com/synthetic-installer'});res.end();}
    else if(req.url==='/content')res.end(updateBytes);
    else {res.writeHead(404);res.end();}
  });
  await new Promise((resolve,reject)=>{updateServer.once('error',reject);updateServer.listen(0,'127.0.0.1',resolve);});
  const updateBase=`http://127.0.0.1:${updateServer.address().port}`;
  const wrapUpdateFetch=fetcher=>(url,options)=>{
    const host=new URL(url).hostname,path=host==='api.github.com'?'/release':host==='github.com'?'/redirect':host==='release-assets.githubusercontent.com'?'/content':null;
    assert.ok(path,'Unexpected updater host');return fetcher(updateBase+path,options);
  };
  let closed=false;
  return { ...local, close:async()=>{if(closed)return;closed=true;updateServer.closeAllConnections();await new Promise(resolve=>updateServer.close(resolve));await local.close();},id,bytes,artifact,call,wrapUpdateFetch,openUpdate:async path=>{assert.deepEqual(readFileSync(path),updateBytes);updateOpened=true;return '';},updateOpened:()=>updateOpened };
}

export async function runClientSmoke({ window, fixture, remote, dataDir, getCopied }) {
  const apiReads=[],fetcher=remote.fetcher;let failDetail=false;
  remote.fetcher=async(url,options)=>{
    const path=new URL(url).pathname+new URL(url).search;apiReads.push(path);
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
  check(await run(() => !document.getElementById('auth-panel').hidden), 'connection screen renders before API login');
  const initial = await status();
  check(initial.phase === 'idle' && initial.label === '未连接' && Math.max(...initial.color) - Math.min(...initial.color) < 20, 'initial connection indicator is gray and explicitly not connected');
  // Well-formed but unauthorized, synthetic credential: reaches the fixture's
  // real authentication endpoint instead of only testing client validation.
  const invalidCredential = 'synthetic-invalid-credential-' + randomUUID();
  const connecting = await run((apiUrl, token) => {
    document.getElementById('credential-mode').click();
    document.getElementById('api-address').value = apiUrl;
    document.getElementById('admin-token').value = token;
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
  check(red(rejected) && rejected.reason.includes('凭证') && !remote.descriptor().connected, 'invalid credential displays a red light and authentication-specific explanation');
  await capture('client-connection-auth-failed.png');
  await run((apiUrl, token) => {
    document.getElementById('api-address').value = apiUrl;
    document.getElementById('admin-token').value = token;
    document.getElementById('login-form').requestSubmit();
  }, fixture.apiUrl, fixture.adminToken);
  await wait(() => run(() => document.getElementById('create-game').options.length === 10 && !document.getElementById('disconnect').hidden), 'Login/game catalogue failed.');
  const connected = await status();
  check(connected.phase === 'connected' && connected.label === '已连接' && green(connected), 'valid credential displays a green light only after API identity verification');
  check(await run(() => !document.getElementById('admin-token').value), 'credential input cleared after login');
  const info = await run(() => window.coopDesktop.getConnection());
  check(info.connected && !Object.hasOwn(info, 'token') && !Object.hasOwn(info, 'adminToken'), 'connection descriptor contains no credential');
  check(!readFileSync(join(dataDir, 'remote-connection.json'), 'utf8').includes(fixture.adminToken), 'non-remembered token absent from disk config');
  await wait(()=>run(()=>!document.getElementById('replay-loading').hidden),'Loading screen did not appear during slow response');
  const loadingUi=await run(()=>({startupHidden:document.getElementById('startup-screen').hidden,detailHidden:document.getElementById('detail').hidden,animation:getComputedStyle(document.querySelector('#replay-loading .loading-spinner')).animationName,reduced:matchMedia('(prefers-reduced-motion:reduce)').matches}));
  check(loadingUi.startupHidden&&loadingUi.detailHidden&&(loadingUi.animation==='loading-spin'||loadingUi.reduced),`startup finishes and replay loader honors motion preference: ${JSON.stringify(loadingUi)}`);
  await capture('client-replay-loading.png');
  await wait(()=>run(()=>!document.getElementById('detail').hidden&&document.getElementById('player-grid').dataset.messages==='ready'),'Board/current decision failed to render');
  check(!apiReads.some(path=>/\/artifacts/.test(path)||/limit=25/.test(path)||/playerId=p[23]/.test(path)),'first board does not prefetch attachments, duplicate raw-message pages, or idle players');
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
  await wait(() => run(() => document.getElementById('verification-result').textContent.includes('true')), 'Replay UI failed.');
  checks.push('deterministic replay through remote API');
  await run(() => document.querySelector('[data-download-artifact]').click());
  await wait(() => Promise.resolve(existsSync(join(dataDir, fixture.artifact.name))), 'Attachment was not downloaded.');
  await wait(() => Promise.resolve(readFileSync(join(dataDir, fixture.artifact.name)).equals(fixture.bytes)), 'Downloaded attachment differs.');
  checks.push('attachment download preserves exact bytes and SHA-256');
  await run(() => document.getElementById('copy-api').click());
  await wait(() => Promise.resolve(getCopied() === fixture.apiUrl), 'Copy API bridge failed.');
  checks.push('copy API bridge');
  await run(()=>document.getElementById('open-create').click());
  await run(()=>document.getElementById('create-room').click());
  await wait(()=>run(()=>!document.getElementById('room-panel').hidden&&document.getElementById('room-panel').textContent.includes('复制邀请链接')),'Admin invitation room did not appear');
  await run(()=>[...document.querySelectorAll('#room-panel button')].find(b=>b.textContent==='复制邀请链接').click());
  await wait(()=>Promise.resolve(getCopied()?.startsWith('coopbench://join#')),'Admin invitation copy failed');
  check(await run(()=>document.getElementById('room-panel').textContent.includes('60 秒')&&[...document.querySelectorAll('#room-panel button')].find(b=>b.textContent==='人齐，开始游戏').disabled),'admin creates invitation room and prevents starting without ready seats');
  await run(()=>document.getElementById('create-dialog').close());
  let screenshot;
  try { const picture = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); assert.ok(!picture.isEmpty()); writeFileSync(join(dataDir, 'client-audit.png'), picture.toPNG()); screenshot = { saved: true }; }
  catch (error) { screenshot = { saved: false, error: String(error) }; }
  await capture('client-connection-success.png');
  // The failure/retry and paging checks above deliberately spend the shared
  // heavy-read burst. Let one token refill before testing a non-retryable POST.
  await new Promise(resolve=>setTimeout(resolve,3500));
  await run(() => {
    document.getElementById('open-create').click();
    const game = document.getElementById('create-game'); game.value = 'hanabi'; game.dispatchEvent(new Event('change'));
    document.getElementById('create-players').value = '3'; document.getElementById('create-form').requestSubmit();
  });
  await wait(() => run(() => document.getElementById('seat-list').querySelectorAll('button').length === 3), 'Create game/seat configs failed.');
  check(await run(() => document.getElementById('seat-list').textContent.includes('p1')), 'three private player connection configs rendered');
  await run(() => document.getElementById('seat-list').querySelector('button').click());
  await wait(() => Promise.resolve(getCopied()?.includes('seatToken')), 'Copy seat config failed.');
  const copied = JSON.parse(getCopied()); check(copied.baseUrl === fixture.apiUrl && copied.episodeId !== fixture.id && typeof copied.seatToken === 'string' && copied.gameId==='hanabi' && copied.scenarioId==='base' && copied.playerId==='p1', 'seat config copies current API, episode, game, scenario and own player');
  await fixture.call(`/episodes/${copied.episodeId}/truncate`, fixture.adminToken, { reason: 'synthetic UI-created episode cleanup' });
  await run(()=>{document.getElementById('open-create').click();document.getElementById('create-room').click();});
  await wait(()=>run(()=>!document.getElementById('room-panel').hidden&&document.getElementById('room-panel').textContent.includes('复制邀请链接')),'Invitation room did not render.');
  await run(()=>[...document.getElementById('room-panel').querySelectorAll('button')].find(b=>b.textContent.includes('邀请')).click());
  await wait(()=>Promise.resolve(getCopied()?.startsWith('coopbench://join#')),'Invitation was not copied.');
  const invitationParams=new URLSearchParams(new URL(getCopied()).hash.slice(1));
  const createdRoom=await fixture.call(`/rooms/${invitationParams.get('room')}/admin`);
  check(createdRoom.status==='waiting'&&createdRoom.episodeId===null&&!('seats' in createdRoom),'operator creates a pre-deal room and copies an invitation without player credentials');
  if (remote.store.encryption.isEncryptionAvailable()) {
    await remote.connect({ apiUrl: fixture.apiUrl, token: fixture.adminToken, remember: true });
    const saved = readFileSync(join(dataDir, 'remote-connection.json'), 'utf8');
    check(saved.includes('encrypted') && !saved.includes(fixture.adminToken) && remote.store.load().token === fixture.adminToken, 'native secure storage encrypts and restores a server-bound credential');
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
    document.getElementById('new-password').value = password;
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
  await fixture.close(); // startLocalApp.close is idempotent; main may close again.
  await run(() => document.getElementById('check-connection').click());
  await wait(async () => (await status()).phase === 'disconnected', 'Manual check after fixture shutdown did not report a disconnected API.');
  const disconnected = await status();
  check(red(disconnected) && disconnected.label === '连接已断开' && !disconnected.reason.includes('凭证无效'), 'manual check after server shutdown replaces green with red and does not blame the credential');
  await capture('client-connection-server-offline.png');
  await run(() => document.getElementById('disconnect').click());
  await wait(() => run(() => document.getElementById('disconnect').hidden && !document.getElementById('seat-list').textContent && !document.getElementById('model-messages').textContent), 'Logout did not clear captured data.');
  check(!remote.descriptor().connected && !readFileSync(join(dataDir, 'remote-connection.json'), 'utf8').includes('encrypted'), 'logout clears credential and saved secret');
  return { ok: true, at: new Date().toISOString(), fixture: `isolated synthetic localhost ${fixture.backend??'sqlite'} API; no production data or model calls`, games: 10, checks, screenshot, screenshots };
}
