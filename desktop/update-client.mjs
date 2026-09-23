import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ClientConnectionError } from './remote-session.mjs';

export const REPOSITORY = 'https://github.com/neutralino-ai/coop-bench';
const LATEST = 'https://api.github.com/repos/neutralino-ai/coop-bench/releases/latest';
const LIMIT = 300 * 1024 * 1024;
const fail = (message, code = 'UPDATE_FAILED') => { throw new ClientConnectionError(code, message); };
const storageCode = error => error?.code ?? error?.cause?.code;
const transientDownloadError = error => error?.code === 'UPDATE_TRANSIENT' || error instanceof TypeError;
const retryDelay = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason);
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  signal.addEventListener('abort', abort, { once: true });
});
const versionParts = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ? value.split('.').map(Number) : null;
export function isNewer(candidate, current) {
  const a = versionParts(candidate), b = versionParts(current);
  if (!a || !b || [...a, ...b].some(n => !Number.isSafeInteger(n))) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function selectRelease(release, current, platform, arch) {
  const version = release?.tag_name?.replace(/^v/, '');
  if (!versionParts(version) || release.draft !== false || release.prerelease !== false || release.html_url !== `${REPOSITORY}/releases/tag/${release.tag_name}`)
    fail('GitHub 发布信息不完整，未选择安装文件。');
  if (!isNewer(version, current)) return { state: 'latest', latestVersion: version };
  const suffix = platform === 'win32' && arch === 'x64' ? 'win-x64.exe' : platform === 'darwin' && ['x64', 'arm64'].includes(arch) ? `mac-${arch}.dmg` : null;
  if (!suffix) fail('当前系统架构暂无安装包。');
  const name = `Coop-Bench-${version}-${suffix}`, candidates = (release.assets ?? []).filter(a => a.name === name);
  if (candidates.length !== 1) fail(`新版本 ${version} 暂无当前系统的安装包，请稍后再试。`);
  const asset = candidates[0], url = `${REPOSITORY}/releases/download/${release.tag_name}/${name}`;
  if (asset.browser_download_url !== url || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > LIMIT || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? ''))
    fail('安装包缺少有效的大小或 SHA-256 校验信息，未下载。');
  return { state: 'available', latestVersion: version, asset: { name, url, size: asset.size, sha256: asset.digest.slice(7) } };
}

// Only fixed GitHub endpoints are reachable. This client never receives game
// credentials and uses an independent network session with omitted cookies.
export class UpdateClient {
  constructor({ currentVersion, platform = process.platform, arch = process.arch, directory, fetcher = fetch, opener }) {
    Object.assign(this, { currentVersion, platform, arch, directory, fetcher, opener });
    this.state = 'idle'; this.busy = false; this.asset = null; this.controller = null;
  }
  info() { return { currentVersion: this.currentVersion, platform: this.platform, arch: this.arch, state: this.state, latestVersion: this.latestVersion ?? null, repository: REPOSITORY, downloaded: this.downloaded ?? 0, total: this.asset?.size ?? 0 }; }
  stop() { this.controller?.abort(); }
  async task(state, timeout, work) {
    if (this.busy) fail('更新操作正在进行，请稍候。', 'UPDATE_BUSY');
    this.busy = true; this.state = state; this.controller = new AbortController();
    const timer = setTimeout(() => this.controller?.abort(), timeout);
    try { await work(this.controller.signal); return this.info(); }
    catch (error) {
      this.state = 'error';
      if (error instanceof ClientConnectionError) throw error;
      if (this.controller.signal.aborted) fail(state === 'downloading' ? '下载超时，已丢弃未完成的安装包。请重试。' : '检查更新超时，请稍后重试。', 'UPDATE_TIMEOUT');
      const code = storageCode(error);
      if (['ENOSPC', 'EDQUOT'].includes(code)) fail('更新目录空间不足，无法保存安装包。', 'UPDATE_STORAGE');
      if (['EACCES', 'EPERM', 'EROFS'].includes(code)) fail('更新目录无法写入，请检查文件夹权限。', 'UPDATE_STORAGE');
      if (state === 'downloading' && transientDownloadError(error)) fail('GitHub 安装包连接中断，自动重试仍未完成。请稍后重试。', 'UPDATE_NETWORK');
      fail('无法完成更新。请检查 GitHub 网络连接和磁盘空间后重试。');
    }
    finally { clearTimeout(timer); this.busy = false; this.controller = null; }
  }
  async check() {
    return this.task('checking', 25000, async signal => {
      this.asset = null; this.file = null; this.downloaded = 0;
      const response = await this.fetcher(LATEST, { method: 'GET', redirect: 'error', credentials: 'omit', signal, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Coop-Bench-Updater', 'X-GitHub-Api-Version': '2022-11-28' } });
      if (response.status === 404) fail('仓库尚无公开发布的版本，请稍后检查。');
      if ([403, 429].includes(response.status)) fail('GitHub 暂时限制了检查频率，请稍后再试。');
      if (response.status !== 200) fail('GitHub 暂不可用，未获取版本信息。');
      const reader = response.body.getReader(), chunks = []; let length = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 2 * 1024 * 1024) fail('GitHub 发布信息过大。'); chunks.push(value); } }
      finally { await reader.cancel().catch(() => {}); }
      const selected = selectRelease(JSON.parse(Buffer.concat(chunks).toString('utf8')), this.currentVersion, this.platform, this.arch);
      Object.assign(this, selected);
    });
  }
  async download() {
    if (!this.asset || !['available', 'error', 'ready'].includes(this.state)) fail('请先检查并选择可用的新版本。');
    return this.task('downloading', 30 * 60 * 1000, async signal => {
      const asset = this.asset; this.file = null; this.downloaded = 0;
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const destination = join(this.directory, asset.name), temporary = destination + '.part';
      await rm(temporary, { force: true });
      const downloadOnce = async () => {
        this.downloaded = 0;
        let handle;
        try {
        let url = asset.url, response;
        for (let redirects = 0; redirects <= 4; redirects++) {
          response = await this.fetcher(url, { method: 'GET', redirect: 'manual', credentials: 'omit', signal });
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          const location = response.headers.get('location'); await response.body?.cancel();
          if (!location || redirects === 4) fail('安装包下载重定向异常。');
          const next = new URL(location, url);
          if (next.protocol !== 'https:' || next.username || next.password || next.port || next.hash || !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(next.hostname))
            fail('安装包下载指向非 GitHub 发布地址，已拒绝。');
          url = next.href;
        }
        if ([429, 500, 502, 503, 504].includes(response.status)) { await response.body?.cancel(); fail('GitHub 安装包服务暂不可用，自动重试仍未完成。', 'UPDATE_TRANSIENT'); }
        if (response.status !== 200) fail(`安装包下载失败（HTTP ${response.status}），请重新检查更新。`);
        const length = response.headers.get('content-length');
        if (length !== null && Number(length) !== asset.size) { await response.body?.cancel(); fail('安装包大小与发布信息不一致。'); }
        handle = await open(temporary, 'wx', 0o600);
        const hash = createHash('sha256'), reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            this.downloaded += value.length;
            if (this.downloaded > asset.size) fail('安装包大小超过发布信息。');
            hash.update(value); await handle.writeFile(value);
          }
        } finally { await reader.cancel().catch(() => {}); }
        if (this.downloaded !== asset.size || hash.digest('hex') !== asset.sha256) fail('安装包 SHA-256 校验失败，文件已丢弃。');
        await handle.close(); handle = null;
        await rm(destination, { force: true }); await rename(temporary, destination);
        this.file = destination; this.state = 'ready';
        } finally { await handle?.close(); await rm(temporary, { force: true }); }
      };
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await downloadOnce(); return; }
        catch (error) {
          if (attempt === 2 || signal.aborted || !transientDownloadError(error)) throw error;
          await retryDelay(400 * (attempt + 1), signal);
        }
      }
    });
  }
  async install() {
    if (this.state !== 'ready' || !this.file || !this.asset) fail('安装包尚未下载并校验，请先下载。');
    return this.task('opening', 30000, async () => {
      const bytes = await readFile(this.file);
      if (bytes.length !== this.asset.size || createHash('sha256').update(bytes).digest('hex') !== this.asset.sha256) { this.file = null; fail('本地安装包已变化，请重新下载。'); }
      if (await this.opener(this.file)) fail('无法打开安装程序，请检查系统权限。');
      this.state = 'opened';
    });
  }
}
