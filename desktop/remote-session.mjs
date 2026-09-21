import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_API = 'https://coop.neutrinophysics.cn:34936/api/v1';
const MAX_RESPONSE = 64 * 1024 * 1024;
export class ClientConnectionError extends Error {
  constructor(code, message, status) {
    super(message); this.name = 'ClientConnectionError'; this.code = code;
    if (Number.isInteger(status)) this.status = status;
  }
}
// Only locally authored messages cross IPC; never expose a server body or a raw
// networking exception (which can include headers, URLs or other private data).
export function publicConnectionError(error) {
  return error instanceof ClientConnectionError
    ? { code: error.code, message: error.message, ...(error.status === undefined ? {} : { status: error.status }) }
    : { code: 'CLIENT_ERROR', message: '客户端无法完成操作，请检查本机配置和访问权限。' };
}
const requireThat = (value, message, code = 'CLIENT_ERROR', status) => { if (!value) throw new ClientConnectionError(code, message, status); };
function networkError(error) {
  const hints = [error?.code, error?.message, error?.cause?.code, error?.cause?.message].filter(x => typeof x === 'string').join(' ');
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(hints)) return new ClientConnectionError('DNS_ERROR', '域名解析失败，请检查 API 地址和网络。尚未验证访问凭证。');
  if (/ERR_CERT_|CERT_|ERR_SSL_|SSL_|TLS_|UNABLE_TO_VERIFY|SELF_SIGNED/i.test(hints)) return new ClientConnectionError('TLS_ERROR', 'HTTPS 握手或证书校验失败，请检查服务器入口和证书。尚不能判断访问凭证是否正确。');
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(hints)) return new ClientConnectionError('CONNECTION_REFUSED', '服务器拒绝连接：此地址或端口可能没有服务监听。尚未验证访问凭证。');
  return new ClientConnectionError('NETWORK_UNREACHABLE', '无法连接 API：请检查网络、服务器地址和端口。尚不能判断访问凭证是否正确。');
}
function requireLoginStatus(status, health = false) {
  if (status === 200) return;
  if (status === 401 && !health) throw new ClientConnectionError('AUTH_REJECTED', 'API 拒绝了访问凭证：凭证无效、已过期或已被撤销。请使用组织者提供的人工 API 凭证。', status);
  if (status === 401) throw new ClientConnectionError('PROXY_AUTH_REQUIRED', '健康检查被要求额外认证，尚未验证 API 凭证。请由服务管理员检查入口认证设置。', status);
  if (status === 403) throw new ClientConnectionError('PERMISSION_DENIED', '服务器拒绝访问，请检查入口访问限制和此凭证的权限。', status);
  if (status >= 500 || status === 429) throw new ClientConnectionError('API_UNAVAILABLE', `服务器暂不可用（HTTP ${status}），请稍后检查。`, status);
  throw new ClientConnectionError('INCOMPATIBLE_API', `此地址未提供预期 API（HTTP ${status}），请检查地址和端口。`, status);
}
const validToken = token => typeof token === 'string' && token.length >= 24 && token.length <= 256 && /^[A-Za-z0-9._~+\/-]+=*$/.test(token);
const validUser = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value);
const validPassword = (value, newPassword = false) => typeof value === 'string' && value.isWellFormed() &&
  Array.from(value).length >= (newPassword ? 12 : 1) && Array.from(value).length <= 128 &&
  Buffer.byteLength(value) <= 512 && (!newPassword || value.trim().length > 0);
function jsonResponse(result) {
  try { const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value;
  } catch { throw new ClientConnectionError('INVALID_API_RESPONSE', '未收到有效 JSON API 响应。'); }
}
// Authentication responses are consumed only in the main process. In particular,
// adding these routes to the generic renderer request allowlist would leak tokens.
function authRequest(input) {
  requireThat(/^\/api\/v1\/auth\/(?:login|password|logout)$/.test(input.path) && input.method === 'POST' ||
    /^\/api\/v1\/auth\/(?:status|account)$/.test(input.path) && input.method === 'GET', '认证请求无效。');
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  requireThat(body === undefined || Buffer.byteLength(body) <= 4096, '认证请求过大。');
  return { path: input.path, method: input.method, body };
}
export function normalizeApiUrl(value) {
  requireThat(typeof value === 'string' && value.length <= 2048, '请输入 API 地址。');
  const raw = value.trim();
  requireThat(!/[\\\s]/.test(raw), 'API 地址不能包含空白或反斜杠。');
  let url; try { url = new URL(raw); } catch { throw new ClientConnectionError('CLIENT_ERROR', 'API 地址格式不正确。'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  requireThat(url.protocol === 'https:' || (url.protocol === 'http:' && loopback), '远程 API 必须使用 HTTPS；HTTP 仅允许本机回环地址。');
  requireThat(!url.username && !url.password && !url.search && !url.hash, '地址中不能包含凭证、查询参数或片段。');
  requireThat(['', '/', '/api/v1', '/api/v1/'].includes(url.pathname), 'API 路径应为 /api/v1。');
  return url.origin + '/api/v1';
}

export function validateRequest(input) {
  requireThat(input && typeof input === 'object' && !Array.isArray(input), '请求格式错误。');
  requireThat(Object.keys(input).every(key => ['id', 'path', 'method', 'body'].includes(key)), '请求包含不支持的字段。');
  requireThat(typeof input.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(input.id), '请求 ID 无效。');
  requireThat(['GET', 'POST'].includes(input.method), '不支持此请求方法。');
  requireThat(typeof input.path === 'string' && input.path.length < 4096 && input.path.startsWith('/api/v1/') && !/[\x00-\x20\x7f]/.test(input.path), '只能访问已配置的 API。');
  const [path] = input.path.split('?');
  requireThat(!/[\\%#\s]/.test(path) && !path.includes('//') && !path.includes('..') && !input.path.includes('#'), 'API 路径无效。');
  const url = new URL(input.path, 'https://local.invalid');
  requireThat(url.origin === 'https://local.invalid' && url.pathname === path, 'API 路径无效。');
  const id = '[A-Za-z0-9_-]+';
  const get = new RegExp(`^/api/v1/(health|identity|lobby|games(?:/${id})?|rooms(?:/${id}/admin)?|rollouts(?:/${id}(?:/(?:observations|messages|artifacts(?:/${id}/content)?))?)?|episodes/${id}/(?:replay|training|audit))$`);
  const post = new RegExp(`^/api/v1/(lobby/${id}/join|rooms|rooms/${id}/admin-(?:start|kick|invite|seat-tokens)|episodes|episodes/${id}/truncate|rollouts/${id}/annotations)$`);
  requireThat((input.method === 'GET' ? get : post).test(path), '此接口不属于人类客户端；Agent 请使用独立座位 API。');
  requireThat(input.method !== 'GET' || input.body === undefined, 'GET 不能携带请求体。');
  requireThat(input.method !== 'POST' || (input.body && typeof input.body === 'object' && !Array.isArray(input.body)), 'POST 需要 JSON 对象。');
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  requireThat(body === undefined || Buffer.byteLength(body) <= 65536, '请求体超过 64 KiB。');
  return { path: url.pathname + url.search, method: input.method, body };
}

// Only the API URL is plaintext. The encrypted payload binds the token to it.
export class ConnectionStore {
  constructor(file, encryption) { this.file = file; this.encryption = encryption; }
  load() {
    if (!existsSync(this.file)) return { apiUrl: DEFAULT_API };
    try {
      requireThat(statSync(this.file).size <= 32768, '配置过大。');
      const raw = readFileSync(this.file); requireThat(raw.length <= 32768, '配置过大。');
      const config = JSON.parse(raw); requireThat(config.schema === 'coop-client-connection/v1', '配置版本无效。');
      const apiUrl = normalizeApiUrl(config.apiUrl);
      if (typeof config.encrypted !== 'string' || !this.encryption.isEncryptionAvailable()) return { apiUrl };
      const secret = JSON.parse(this.encryption.decryptString(Buffer.from(config.encrypted, 'base64')));
      requireThat(secret.apiUrl === apiUrl && validToken(secret.token), '凭证与服务器不匹配。');
      return { apiUrl, token: secret.token };
    } catch { return { apiUrl: DEFAULT_API }; }
  }
  save(apiUrl, token, remember) {
    const config = { schema: 'coop-client-connection/v1', apiUrl: normalizeApiUrl(apiUrl) };
    if (remember) {
      requireThat(validToken(token), '访问凭证格式不正确。');
      requireThat(this.encryption.isEncryptionAvailable(), '系统安全存储不可用，请取消“记住凭证”后连接。');
      config.encrypted = this.encryption.encryptString(JSON.stringify({ apiUrl: config.apiUrl, token })).toString('base64');
    }
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = this.file + '.' + randomUUID() + '.tmp';
    try { writeFileSync(temp, JSON.stringify(config), { mode: 0o600, flag: 'wx' }); renameSync(temp, this.file); }
    finally { if (existsSync(temp)) unlinkSync(temp); }
  }
}

export class RemoteSession {
  constructor({ fetcher, store, timeoutMs = 20000, maxResponse = MAX_RESPONSE }) {
    requireThat(typeof fetcher === 'function' && Number.isFinite(timeoutMs) && timeoutMs > 0 && Number.isSafeInteger(maxResponse) && maxResponse > 0 && maxResponse <= MAX_RESPONSE, '客户端请求配置无效。');
    this.fetcher = fetcher; this.store = store; this.timeoutMs = timeoutMs; this.maxResponse = maxResponse;
    const saved = store.load(); this.apiUrl = saved.apiUrl; this.saved = saved;
    this.token = ''; this.identity = null; this.remembered = Boolean(saved.token);
    this.epoch = 0; this.pending = new Map(); this.restorePromise = null; this.passwordEpoch = null;
  }
  descriptor() { return { mode: 'remote', apiUrl: this.apiUrl, connected: Boolean(this.token && this.identity), identity: this.identity ? structuredClone(this.identity) : null, remembered: this.remembered }; }
  invalidate() { this.epoch++; for (const controller of this.pending.values()) controller.abort(); this.pending.clear(); this.token = ''; this.identity = null; this.passwordEpoch = null; }
  disconnect() { this.invalidate(); this.saved = null; this.remembered = false; this.store.save(this.apiUrl, '', false); return this.descriptor(); }
  cancel(id) { this.pending.get(id)?.abort(); }
  async restore() {
    this.restorePromise ??= (async () => {
      const saved = this.saved; this.saved = null;
      if (saved?.token) {
        const attempt = this.connect({ apiUrl: saved.apiUrl, token: saved.token, remember: true }), epoch = this.epoch;
        try { await attempt; }
        catch (error) { return { epoch, connectionError: publicConnectionError(error) }; }
      }
      return null;
    })();
    const restored = await this.restorePromise;
    return { ...this.descriptor(), ...(restored?.epoch === this.epoch ? { connectionError: restored.connectionError } : {}) };
  }
  async wire(apiUrl, token, input, epoch = this.epoch, authentication = false) {
    requireThat(epoch === this.epoch, '连接已更换或请求已取消，旧请求已丢弃。', 'CANCELLED');
    requireThat(this.pending.size < 8, '请求过多，请稍后重试。');
    requireThat(!this.pending.has(input.id), '请求 ID 重复。');
    const request = authentication ? authRequest(input) : validateRequest(input), controller = new AbortController();
    this.pending.set(input.id, controller);
    const binary = request.path.split('?')[0].endsWith('/content');
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, binary ? 120000 : this.timeoutMs);
    try {
      const response = await this.fetcher(new URL(request.path, apiUrl).href, {
        method: request.method, headers: { Accept: binary ? 'application/octet-stream' : 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(request.body === undefined ? {} : { body: request.body }), credentials: 'omit', redirect: 'error', signal: controller.signal,
      });
      requireThat(!response.redirected && (response.status < 300 || response.status >= 400), 'API 重定向被拒绝，请填写最终 HTTPS 地址。', 'INVALID_API_RESPONSE', response.status);
      const auth = response.headers.get('www-authenticate') ?? '';
      if (response.status === 407 || response.status === 401 && /\bBasic\b/i.test(auth)) {
        throw new ClientConnectionError('PROXY_AUTH_REQUIRED', '服务器入口要求网站 / 代理密码（Basic Auth），当前 API 凭证尚未验证。请由服务管理员协调入口认证与 API Bearer 认证。', response.status);
      }
      const type = response.headers.get('content-type') ?? '';
      const mediaType = type.split(';')[0].trim().toLowerCase();
      if (response.status >= 500 && mediaType !== 'application/json') throw new ClientConnectionError('API_UNAVAILABLE', `服务器入口暂不可用（HTTP ${response.status}），请检查反向代理和后端服务。`, response.status);
      requireThat(mediaType === 'application/json' || binary && response.ok && mediaType === 'application/octet-stream', '未收到有效 API 响应：返回了网页或其他格式，请检查 API 地址、入口代理或拦截页面。', 'INVALID_API_RESPONSE', response.status);
      const rawLength = response.headers.get('content-length'), length = rawLength === null ? null : Number(rawLength);
      requireThat(length === null || Number.isSafeInteger(length) && length >= 0 && length <= this.maxResponse, '服务器响应超过大小限制。', 'INVALID_API_RESPONSE');
      const reader = response.body?.getReader(), parts = []; let size = 0;
      if (reader) while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > this.maxResponse) { await reader.cancel(); throw new ClientConnectionError('INVALID_API_RESPONSE', '服务器响应超过大小限制。'); }
        parts.push(value);
      }
      requireThat(epoch === this.epoch && !controller.signal.aborted, '连接已更换或请求已取消，旧响应已丢弃。', 'CANCELLED');
      const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      // Retry-After is required by the renderer's bounded GET backoff. Dropping
      // it made fast audit clients retry downloads before their budget refilled.
      const retryAfter=response.headers.get('retry-after');
      return { status: response.status, headers: { 'content-type': type, 'content-length': String(size),
        ...(response.status===429&&retryAfter&&retryAfter.length<=128?{'retry-after':retryAfter}:{}) }, bytes };
    } catch (error) {
      if (timedOut) throw new ClientConnectionError('TIMEOUT', 'API 请求超时，请检查网络和服务器状态；请求不会自动重试。');
      if (controller.signal.aborted || epoch !== this.epoch || error?.name === 'AbortError') throw new ClientConnectionError('CANCELLED', '连接已更换或请求已取消，旧响应已丢弃。');
      if (error instanceof ClientConnectionError) throw error;
      throw networkError(error);
    } finally { clearTimeout(timer); controller.abort(); if (this.pending.get(input.id) === controller) this.pending.delete(input.id); }
  }
  async connect(input) {
    requireThat(input && typeof input === 'object' && Object.keys(input).every(k => ['apiUrl', 'token', 'remember'].includes(k)), '连接参数无效。');
    const apiUrl = normalizeApiUrl(input.apiUrl), token = typeof input.token === 'string' ? input.token.trim() : '';
    requireThat(validToken(token) && (input.remember === undefined || typeof input.remember === 'boolean'), '访问凭证格式不正确。');
    this.invalidate(); this.apiUrl = apiUrl; this.remembered = false; this.saved = null;
    this.store.save(apiUrl, '', false); // Never retain a previous server's credential on failed switching.
    const epoch = this.epoch;
    const health = await this.wire(apiUrl, '', { id: randomUUID(), path: '/api/v1/health', method: 'GET' }, epoch);
    const json = wire => { try { const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(wire.bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
      catch { throw new ClientConnectionError('INVALID_API_RESPONSE', '未收到有效 JSON API 响应。'); } };
    requireLoginStatus(health.status, true);
    const info = json(health);
    requireThat(info.ok === true && info.service === 'coop-bench' && info.apiVersion === 'v1', '服务不是兼容的 Coop Bench API v1。', 'INCOMPATIBLE_API');
    const result = await this.wire(apiUrl, token, { id: randomUUID(), path: '/api/v1/identity', method: 'GET' }, epoch);
    requireLoginStatus(result.status);
    const identity = json(result);
    requireThat(typeof identity.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(identity.id) && ['coordinator', 'operator', 'auditor'].includes(identity.role), '服务返回的身份无效。', 'INVALID_API_RESPONSE');
    requireThat(epoch === this.epoch, '连接已更换，登录结果已丢弃。', 'CANCELLED');
    this.store.save(apiUrl, token, input.remember === true);
    this.token = token; this.identity = { id: identity.id, role: identity.role,
      ...(identity.transport === 'local' || identity.transport === 'proxy' ? { transport: identity.transport } : {}),
      ...(identity.retention && typeof identity.retention === 'object' && !Array.isArray(identity.retention) ? { retention: identity.retention } : {}) };
    this.remembered = input.remember === true;
    return this.descriptor();
  }
  async checkHealth(apiUrl, epoch) {
    const result = await this.wire(apiUrl, '', { id: randomUUID(), path: '/api/v1/health', method: 'GET' }, epoch);
    requireLoginStatus(result.status, true);
    const info = jsonResponse(result);
    requireThat(info.ok === true && info.service === 'coop-bench' && info.apiVersion === 'v1', '服务不是兼容的 Coop Bench API v1。', 'INCOMPATIBLE_API');
  }
  async acceptSession(result, apiUrl, remember, epoch) {
    const value = jsonResponse(result), expiry = Date.parse(value.expiresAt);
    requireThat(validToken(value.token) && value.token.startsWith('hs1_') && Number.isFinite(expiry) && expiry > Date.now() &&
      validUser(value.identity?.id) && ['operator', 'auditor'].includes(value.identity?.role), '服务器返回的登录会话无效。', 'INVALID_API_RESPONSE');
    const verified = await this.wire(apiUrl, value.token, { id: randomUUID(), path: '/api/v1/identity', method: 'GET' }, epoch);
    requireLoginStatus(verified.status);
    const identity = jsonResponse(verified);
    requireThat(identity.id === value.identity.id && identity.role === value.identity.role, '登录身份验证不一致。', 'INVALID_API_RESPONSE');
    requireThat(epoch === this.epoch, '连接已更换，登录结果已丢弃。', 'CANCELLED');
    this.store.save(apiUrl, value.token, remember);
    this.apiUrl = apiUrl; this.token = value.token; this.identity = { id: identity.id, role: identity.role };
    this.remembered = remember; this.saved = null;
    return this.descriptor();
  }
  async login(input) {
    requireThat(input && typeof input === 'object' && Object.keys(input).every(k => ['apiUrl', 'userId', 'password', 'remember'].includes(k)), '登录参数无效。');
    const apiUrl = normalizeApiUrl(input.apiUrl), userId = typeof input.userId === 'string' ? input.userId.trim() : '';
    requireThat(validUser(userId) && validPassword(input.password) && (input.remember === undefined || typeof input.remember === 'boolean'), '请输入账号及密码。');
    this.invalidate(); this.apiUrl = apiUrl; this.remembered = false; this.saved = null; this.store.save(apiUrl, '', false);
    const epoch = this.epoch;
    await this.checkHealth(apiUrl, epoch);
    const result = await this.wire(apiUrl, '', { id: randomUUID(), path: '/api/v1/auth/login', method: 'POST', body: { userId, password: input.password } }, epoch, true);
    if (result.status === 401) throw new ClientConnectionError('AUTH_REJECTED', '账号或密码不正确，或账号已失效。首次使用请先用个人凭证连接，再到设置中设置密码。', 401);
    if ([404, 503].includes(result.status)) throw new ClientConnectionError('PASSWORD_UNAVAILABLE', '服务器尚未启用账号密码登录，请使用个人凭证连接或联系管理员。', result.status);
    requireLoginStatus(result.status);
    return this.acceptSession(result, apiUrl, input.remember === true, epoch);
  }
  async getAccount() {
    requireThat(this.passwordEpoch === null, '密码正在更新，请稍后读取账号。', 'CANCELLED');
    requireThat(this.token && this.identity, '请先连接 API。');
    const epoch = this.epoch;
    const result = await this.wire(this.apiUrl, this.token, { id: randomUUID(), path: '/api/v1/auth/account', method: 'GET' }, epoch, true);
    requireThat(epoch === this.epoch, '连接已更换，旧账号信息已丢弃。', 'CANCELLED');
    if (result.status === 401) this.disconnect();
    if ([404, 503].includes(result.status)) throw new ClientConnectionError('PASSWORD_UNAVAILABLE', '此服务器尚未启用个人密码设置。', result.status);
    requireLoginStatus(result.status);
    const value = jsonResponse(result);
    requireThat(value.userId === this.identity.id && ['operator', 'auditor'].includes(value.role) && typeof value.passwordConfigured === 'boolean' &&
      ['personal-token', 'password-session'].includes(value.authentication), '服务器返回的账号信息无效。', 'INVALID_API_RESPONSE');
    this.identity.role = value.role;
    return { userId: value.userId, role: value.role, passwordConfigured: value.passwordConfigured, authentication: value.authentication,
      ...(typeof value.sessionExpiresAt === 'string' ? { sessionExpiresAt: value.sessionExpiresAt } : {}) };
  }
  async setPassword(input) {
    requireThat(this.passwordEpoch === null, '密码正在更新，请勿重复提交。', 'CANCELLED');
    requireThat(this.token && this.identity, '请先使用个人凭证或密码登录。');
    requireThat(input && typeof input === 'object' && Object.keys(input).every(k => ['password', 'currentPassword', 'remember'].includes(k)) &&
      validPassword(input.password, true) && (input.currentPassword === undefined || validPassword(input.currentPassword)) &&
      (input.remember === undefined || typeof input.remember === 'boolean'), '新密码需要 12–128 字符，已设置过密码时还需要当前密码。');
    // Cancel in-flight reads using the soon-to-be-revoked session before rotation.
    this.epoch++; for (const controller of this.pending.values()) controller.abort(); this.pending.clear();
    const epoch = this.epoch, apiUrl = this.apiUrl, token = this.token, remember = input.remember ?? this.remembered;
    this.passwordEpoch = epoch;
    try {
    const result = await this.wire(apiUrl, token, { id: randomUUID(), path: '/api/v1/auth/password', method: 'POST',
      body: { password: input.password, ...(input.currentPassword === undefined ? {} : { currentPassword: input.currentPassword }) } }, epoch, true);
    if ([400, 401, 409].includes(result.status)) throw new ClientConnectionError('PASSWORD_REJECTED', '密码设置未完成：请检查当前密码、新密码要求及账号登录状态。', result.status);
    if ([404, 503].includes(result.status)) throw new ClientConnectionError('PASSWORD_UNAVAILABLE', '服务器尚未启用密码设置。', result.status);
    requireLoginStatus(result.status);
    try { return await this.acceptSession(result, apiUrl, remember, epoch); }
    catch (error) {
      if (epoch === this.epoch) this.disconnect();
      if (error?.code === 'CANCELLED') throw error;
      throw new ClientConnectionError('PASSWORD_UPDATED_RELOGIN', '密码已更新，但新会话未能保存或验证。请使用新密码重新登录。');
    }
    } finally { if (this.passwordEpoch === epoch) this.passwordEpoch = null; }
  }
  async logout() {
    const apiUrl = this.apiUrl, token = this.token, result = this.disconnect(), epoch = this.epoch;
    if (!token.startsWith('hs1_')) return result;
    try {
      const response = await this.wire(apiUrl, token, { id: randomUUID(), path: '/api/v1/auth/logout', method: 'POST', body: {} }, epoch, true);
      requireThat(response.status === 200 || response.status === 401, '退出请求未完成。');
      return result;
    } catch { return { ...result, logoutWarning: '本机登录信息已清除；服务器会话未能确认撤销，将在到期后失效。' }; }
  }
  async request(input) {
    const request = validateRequest(input);
    const publicRead = input.method === 'GET' && /^\/api\/v1\/(?:health|games(?:\/[^?]+)?)(?:\?|$)/.test(request.path);
    requireThat(publicRead || this.passwordEpoch === null, '密码正在更新，旧会话请求已取消。', 'CANCELLED');
    requireThat(publicRead || this.token && this.identity, '请先连接 API。');
    const epoch = this.epoch, result = await this.wire(this.apiUrl, publicRead ? '' : this.token, input, epoch);
    requireThat(epoch === this.epoch, '连接已更换或请求已取消，旧响应已丢弃。', 'CANCELLED');
    if (result.status === 401 && !publicRead) this.disconnect();
    return result;
  }
}
