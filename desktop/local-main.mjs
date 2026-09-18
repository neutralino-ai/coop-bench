import { app, BrowserWindow, clipboard, dialog, ipcMain } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const smoke = process.argv.includes('--smoke-test');
const dataArgument = process.argv.find(value => value.startsWith('--data-dir='))?.slice('--data-dir='.length);
const customDataDir = dataArgument ? resolve(dataArgument) : null;
const reportPath = customDataDir ? resolve(customDataDir, 'desktop-smoke-result.json') : null;
let localApp;
let window;
let closePromise;
let quitting = false;
let smokeCopiedText;

app.setName('Coop Bench');

function report(value) {
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function closeLocalApp() {
  closePromise ??= Promise.resolve().then(() => localApp?.close());
  return closePromise;
}

async function request(path, token, body, key) {
  const response = await fetch(`${localApp.apiUrl.replace(/\/$/, '')}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  const value = await response.json();
  assert.ok(response.ok, `${path}: HTTP ${response.status} ${JSON.stringify(value)}`);
  return value;
}

async function smokeTest() {
  const startedAt = new Date().toISOString();
  const health = await request('/health');
  assert.equal(health.ok, true);
  const catalogue = await request('/games');
  assert.ok(catalogue.games.some(game => game.id === 'take-time'));
  await createWindow({ show: false, path: '/play' });
  const renderer = await window.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now() + 10000;
    while (document.getElementById('game').options.length !== 10 ||
           !document.getElementById('admin').value) {
      if (Date.now() > deadline) throw new Error('Desktop UI did not initialize: ' + document.getElementById('result').textContent);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    const connection = await window.coopDesktop.getConnection();
    if (document.getElementById('admin').value !== '@local-human') throw new Error('Desktop coordinator session was not initialized.');
    if (typeof window.require !== 'undefined' || typeof window.process !== 'undefined') throw new Error('Node primitives leaked into renderer.');
    document.getElementById('copy-api').click();
    while (document.getElementById('copy-api').disabled) {
      if (Date.now() > deadline) throw new Error('Copy API button did not complete.');
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    if (!document.getElementById('result').textContent.includes('已复制')) throw new Error('Copy API button failed: ' + document.getElementById('result').textContent);
    await document.fonts.ready;
    return { games: document.getElementById('game').options.length, apiUrl: connection.apiUrl };
  })()`, true);
  assert.equal(renderer.games, 10);
  assert.equal(renderer.apiUrl, localApp.apiUrl);
  assert.equal(smokeCopiedText, localApp.apiUrl);
  const preferences = window.webContents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  // Some headless/hidden Windows compositors cannot capture a frame even though
  // the real renderer and IPC assertions above work. Screenshot is evidence,
  // not a precondition for exercising the game's API.
  let screenshot;
  try {
    const picture=await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
    assert.ok(!picture.isEmpty(),'Screenshot is empty.');
    writeFileSync(resolve(customDataDir,'desktop-smoke.png'),picture.toPNG());
    screenshot={saved:true};
  }catch(error){screenshot={saved:false,error:String(error)};}
  const created = await request('/episodes', localApp.adminToken, {
    gameId: 'take-time', scenarioId: 'official-clock-1-1', playerCount: 3,
  });
  const [seat, other] = created.seats;
  const path = `/episodes/${encodeURIComponent(created.episodeId)}`;
  const observation = await request(`${path}/observation`, seat.token);
  assert.equal(observation.view.hand, null);
  const command = {
    observationId: observation.observationId,
    decisionToken: observation.decisionToken,
    action: { type: 'look_hand' },
  };
  const key = randomUUID();
  const receipt = await request(`${path}/actions`, seat.token, command, key);
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.observation.view.hand.length, 4);
  assert.deepEqual(await request(`${path}/actions`, seat.token, command, key), receipt);
  assert.equal((await request(`${path}/observation`, other.token)).view.hand, null);
  await request(`${path}/truncate`, localApp.adminToken, { reason: 'packaged-desktop-smoke-test' });
  const replay = await request(`${path}/replay`, localApp.adminToken);
  assert.equal(replay.valid, true);
  report({
    ok: true, startedAt, finishedAt: new Date().toISOString(),
    platform: process.platform, arch: process.arch, packaged: app.isPackaged,
    electron: process.versions.electron, node: process.versions.node,
    games: catalogue.games.length, build: health.build, screenshot,
    checks: ['health', 'catalogue', 'renderer', 'preload-connection', 'renderer-isolation',
      'copy-button-bridge', 'bundled-take-time-engine', 'sqlite-create',
      'private-observation', 'action', 'idempotent-retry', 'seat-isolation', 'truncate', 'replay'],
  });
}

function createWindow({ show = true, path = '/' } = {}) {
  window = new BrowserWindow({
    width: 1360, height: 920, minWidth: 950, minHeight: 640,
    title: 'Coop Bench', show: false, autoHideMenuBar: true,
    webPreferences: {
      preload: resolve(here, 'local-preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      ...(smoke ? { backgroundThrottling: false } : {}),
    },
  });
  const origin = new URL(localApp.baseUrl).origin;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  if (show) window.once('ready-to-show', () => window.show());
  window.on('closed', () => { window = null; });
  return window.loadURL(localApp.baseUrl + path);
}

app.on('second-instance', () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitting || !localApp) return;
  event.preventDefault();
  quitting = true;
  closeLocalApp().then(() => app.quit()).catch(error => {
    console.error('Could not close local game storage:', error);
    app.exit(1);
  });
});

async function main() {
  // Set the profile before Electron opens it, including its single-instance lock.
  // Smoke tests always use a separate explicit profile and cannot overwrite a user's games.
  if (customDataDir) {
    mkdirSync(customDataDir, { recursive: true });
    app.setPath('userData', customDataDir);
  }
  await app.whenReady();
  if (smoke && !customDataDir) throw new Error('--smoke-test requires --data-dir=PATH for an isolated test profile.');
  if (!app.requestSingleInstanceLock()) {
    if (smoke) throw new Error('The smoke-test profile is already in use.');
    app.quit(); return;
  }
  const { startLocalApp } = await import('../runtime/coop-bench/src/server.mjs');
  localApp = await startLocalApp({
    dataDir: customDataDir ?? app.getPath('userData'),
    port: smoke ? 0 : 8788,
    fallbackPort: true,
  });
  const validateSender = event => {
    const frame = event.senderFrame;
    if (!window || event.sender !== window.webContents || frame !== window.webContents.mainFrame ||
        !frame || new URL(frame.url).origin !== new URL(localApp.baseUrl).origin) {
      throw new Error('Connection details are available only to this application window.');
    }
  };
  ipcMain.handle('coop:get-connection', event => {
    validateSender(event);
    return { apiUrl: localApp.apiUrl, adminToken: localApp.adminToken, dbPath: localApp.dbPath };
  });
  ipcMain.handle('coop:copy-text', (event, text) => {
    validateSender(event);
    if (typeof text !== 'string' || text.length > 16_384) throw new Error('Clipboard text exceeds the allowed size.');
    // Validate the real UI/IPC wiring during smoke tests without changing the user's clipboard.
    if (smoke) smokeCopiedText = text;
    else clipboard.writeText(text);
  });
  if (smoke) {
    await smokeTest();
    await closeLocalApp();
    quitting = true;
    app.quit();
  } else {
    await createWindow();
  }
}

main().catch(async error => {
  const message = error instanceof Error ? error.message : String(error);
  if (smoke) {
    try { report({ ok: false, finishedAt: new Date().toISOString(), error: message,
      platform: process.platform, arch: process.arch, packaged: app.isPackaged }); }
    catch (writeError) { console.error('Could not write the smoke-test report:', writeError); }
  }
  else dialog.showErrorBox('Coop Bench 启动失败', `${message}\n\n请关闭重复运行的应用，或检查本地数据目录是否可写。`);
  console.error(error);
  try { await closeLocalApp(); } catch { /* Preserve the original startup failure. */ }
  quitting = true;
  app.exit(1);
});
