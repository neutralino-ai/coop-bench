import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, safeStorage, session, shell } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConnectionStore, RemoteSession, publicConnectionError } from './remote-session.mjs';
import { UpdateClient } from './update-client.mjs';

// Remote mode opens no local game server or database; --local retains the standalone edition.
if (process.argv.includes('--local') || process.argv.includes('--smoke-test')) {
  await import('./local-main.mjs');
} else {
  protocol.registerSchemesAsPrivileged([{ scheme: 'coop', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  const here = dirname(fileURLToPath(import.meta.url));
  const smoke = process.argv.includes('--client-smoke-test');
  const argument = process.argv.find(a => a.startsWith('--data-dir='))?.slice(11);
  const dataDir = argument ? resolve(argument) : join(app.getPath('appData'), 'Coop Bench Client');
  if (smoke && !argument) throw new Error('Client smoke test requires an isolated --data-dir.');
  mkdirSync(dataDir, { recursive: true }); app.setPath('userData', dataDir); app.setName('Coop Bench');
  let window, remote, fixture, copiedText, updater;
  const report = value => writeFileSync(join(dataDir, 'client-smoke-result.json'), JSON.stringify(value, null, 2));
  const trusted = url => { try { const u = new URL(url); return u.protocol === 'coop:' && u.host === 'app' && !u.username && !u.password && ['/', '/index.html'].includes(u.pathname); } catch { return false; } };
  function validateSender(event) {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !trusted(event.senderFrame.url)) throw new Error('此操作仅供客户端主窗口使用。');
  }
  const assets = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/transport.js': 'transport.js', '/style.css': 'style.css', '/replay.css':'replay.css', '/replay-model.js':'replay-model.js', '/replay-ui.js':'replay-ui.js' };
  const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  async function main() {
    if (!app.requestSingleInstanceLock()) { app.quit(); return; }
    await app.whenReady();
    const apiSession = session.fromPartition('coop-api');
    remote = new RemoteSession({ fetcher: (url, options) => apiSession.fetch(url, options), store: new ConnectionStore(join(dataDir, 'remote-connection.json'), safeStorage) });
    if (smoke) {
      const { startClientFixture } = await import('./client-smoke.mjs');
      fixture = await startClientFixture(dataDir);
    }
    // Node fetch exposes manual redirect responses. Electron session.fetch can
    // reject them as "Redirect was cancelled", so keep updates on this stack.
    const updateFetch = (url, options) => fetch(url, options);
    updater = new UpdateClient({ currentVersion: app.getVersion(), directory: join(dataDir, 'updates'),
      fetcher: smoke ? fixture.wrapUpdateFetch(updateFetch) : updateFetch,
      opener: smoke ? fixture.openUpdate : path => shell.openPath(path) });
    protocol.handle('coop', request => {
      const url = new URL(request.url), file = assets[url.pathname];
      if (request.method !== 'GET' || url.host !== 'app' || url.username || url.password || url.search || !file) return new Response('Not found', { status: 404 });
      const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      return new Response(readFileSync(join(here, '../runtime/coop-bench/web', file)), { headers: { 'Content-Type': `${type}; charset=utf-8`, 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
    });
    for (const [name, handler] of Object.entries({
      'get-connection': () => remote.restore(),
      'update-info': () => updater.info(), 'update-check': () => updater.check(),
      'update-download': () => updater.download(), 'update-install': () => updater.install(),
      connect: input => remote.connect(input), login: input => remote.login(input),
      'set-password': input => remote.setPassword(input), 'get-account': () => remote.getAccount(), disconnect: () => remote.logout(),
      request: input => remote.request(input), 'cancel-request': id => { if (typeof id === 'string') remote.cancel(id); },
      'copy-text': text => { if (typeof text !== 'string' || text.length > 65536) throw new Error('复制内容过大。'); if (smoke) copiedText = text; else clipboard.writeText(text); },
    })) ipcMain.handle(`coop:${name}`, async (event, input) => {
      validateSender(event);
      try { return { ok: true, value: await handler(input) }; }
      catch (error) { return { ok: false, error: publicConnectionError(error) }; }
    });
    window = new BrowserWindow({ width: 1440, height: 960, minWidth: 980, minHeight: 680, show: false, backgroundColor: '#f3f5f2', autoHideMenuBar: true,
      title: 'Coop Bench · 游戏与轨迹', webPreferences: { preload: join(here, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, ...(smoke ? { backgroundThrottling: false } : {}) } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!trusted(url)) event.preventDefault(); });
    window.webContents.on('will-redirect', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.session.on('will-download', (event, item, contents) => {
      if (contents !== window?.webContents || !item.getURL().startsWith('blob:coop://app/')) { event.preventDefault(); return; }
      let name = item.getFilename().replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[. ]+$/, '').slice(0, 180);
      if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = 'export-' + (name || 'data.json');
      if (smoke) item.setSavePath(join(dataDir, name));
      else item.setSaveDialogOptions({ title: '保存审计文件', defaultPath: name });
    });
    app.on('login', (event, _contents, _details, _auth, callback) => { event.preventDefault(); callback(); });
    if (!smoke) window.once('ready-to-show', () => window.show());
    window.on('closed', () => { window = null; });
    await window.loadURL('coop://app/');
    if (smoke) {
      const { runClientSmoke } = await import('./client-smoke.mjs');
      const result = await runClientSmoke({ window, fixture, remote, dataDir, getCopied: () => copiedText });
      report({ ...result, packaged: app.isPackaged, platform: process.platform, arch: process.arch, version: app.getVersion() });
      await fixture.close(); remote.invalidate(); app.quit();
    }
  }
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { remote?.invalidate(); updater?.stop(); });
  main().catch(async error => {
    if (smoke) report({ ok: false, error: String(error), stack: error.stack,
      ui: window ? await window.webContents.executeJavaScript(`Object.fromEntries(['message','episode-title','model-message-status','model-messages','artifacts'].map(id=>[id,document.getElementById(id)?.textContent?.slice(0,1000)]))`).catch(() => null) : null });
    else dialog.showErrorBox('Coop Bench 启动失败', String(error.message ?? error));
    await fixture?.close().catch(() => {}); app.exit(1);
  });
}
