// Isolated synthetic UI acceptance data. Never connects to the production service.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function startClientFixture(dataDir) {
  const { startLocalApp } = await import('../runtime/coop-bench/src/server.mjs');
  const personalToken = 'synthetic-owner-' + randomUUID();
  const usersFile = join(dataDir, 'synthetic-access-users.json');
  writeFileSync(usersFile, JSON.stringify({ version: 1, users: [{ id: 'owner', role: 'operator', disabled: false,
    tokenHash: createHash('sha256').update(personalToken).digest('hex') }] }), { mode: 0o600 });
  const local = await startLocalApp({ dataDir: join(dataDir, 'synthetic-api'), port: 0, serveWeb: false,
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
  await call(`/episodes/${id}/actions`, seat, { observationId: observation.observationId, decisionToken: observation.decisionToken, action: { type: 'play', index: 0 }, decisionSummary: '合成测试动作，不是模型推理。' }, randomUUID());
  await call(`/episodes/${id}/truncate`, local.adminToken, { reason: 'synthetic-desktop-client-acceptance' });
  await call(`/episodes/${id}/messages/complete`, seat, { completeness: 'partial', reasoningAvailability: 'not-provided', scope: 'Synthetic UI fixture only', unavailable: ['No real model was invoked.'] });
  const bytes = Buffer.from('合成桌面附件\n{"fixture":true,"modelInvoked":false}\n');
  const artifact = await call(`/episodes/${id}/artifacts`, seat, { name: 'synthetic-client-artifact.jsonl', mediaType: 'application/x-ndjson', kind: 'agent-trace', byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), reasoningAvailability: 'not-provided' }, randomUUID());
  await call(`/episodes/${id}/artifacts/${artifact.id}/chunks`, seat, { index: 0, dataBase64: bytes.toString('base64') });
  await call(`/episodes/${id}/artifacts/${artifact.id}/complete`, seat, {});
  await call(`/rollouts/${id}/annotations`, local.adminToken, { kind: 'review', text: '合成 UI 审计 <img src=x onerror="window.__smokeXss=1">' });
  assert.equal((await fetch(local.baseUrl + '/')).status, 404);
  return { ...local, id, bytes, artifact, call };
}

export async function runClientSmoke({ window, fixture, remote, dataDir, getCopied }) {
  const checks = [], check = (value, name) => { assert.ok(value, name); checks.push(name); };
  const run = (fn, ...args) => window.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
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
  await wait(() => run(() => document.getElementById('episode-title').textContent.includes('Hanabi') && document.getElementById('artifacts').querySelector('button') && document.getElementById('model-messages').textContent.includes('synthetic-ui-message')), 'Audit/messages/artifacts failed to render.');
  await run(() => { for (const detail of document.getElementById('model-messages').querySelectorAll('details')) detail.open = true; });
  await wait(() => run(() => document.getElementById('model-messages').textContent.includes('合成验收消息')), 'Original message text did not expand.');
  checks.push('original in-game message expands without rewriting');
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
  let screenshot;
  try { const picture = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); assert.ok(!picture.isEmpty()); writeFileSync(join(dataDir, 'client-audit.png'), picture.toPNG()); screenshot = { saved: true }; }
  catch (error) { screenshot = { saved: false, error: String(error) }; }
  await capture('client-connection-success.png');
  await run(() => {
    const game = document.getElementById('create-game'); game.value = 'hanabi'; game.dispatchEvent(new Event('change'));
    document.getElementById('create-players').value = '3'; document.getElementById('create-form').requestSubmit();
  });
  await wait(() => run(() => document.getElementById('seat-list').querySelectorAll('button').length === 3), 'Create game/seat configs failed.');
  check(await run(() => document.getElementById('seat-list').textContent.includes('p1')), 'three private player connection configs rendered');
  await run(() => document.getElementById('seat-list').querySelector('button').click());
  await wait(() => Promise.resolve(getCopied()?.includes('seatToken')), 'Copy seat config failed.');
  const copied = JSON.parse(getCopied()); check(copied.baseUrl === fixture.apiUrl && copied.episodeId !== fixture.id && typeof copied.seatToken === 'string', 'seat config copies current API and new episode');
  await fixture.call(`/episodes/${copied.episodeId}/truncate`, fixture.adminToken, { reason: 'synthetic UI-created episode cleanup' });
  if (remote.store.encryption.isEncryptionAvailable()) {
    await remote.connect({ apiUrl: fixture.apiUrl, token: fixture.adminToken, remember: true });
    const saved = readFileSync(join(dataDir, 'remote-connection.json'), 'utf8');
    check(saved.includes('encrypted') && !saved.includes(fixture.adminToken) && remote.store.load().token === fixture.adminToken, 'native secure storage encrypts and restores a server-bound credential');
  } else checks.push('native secure storage unavailable on this test host; persistence remains disabled');
  await run(() => document.getElementById('settings-open').click());
  await wait(() => run(() => !document.getElementById('password-form').hidden && !document.getElementById('new-password').disabled), 'Password setup did not become available.');
  const syntheticPassword = 'Synthetic desktop acceptance 9!';
  await run(password => {
    document.getElementById('new-password').value = password;
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
  return { ok: true, at: new Date().toISOString(), fixture: 'isolated synthetic localhost API; no production data or model calls', games: 10, checks, screenshot, screenshots };
}
