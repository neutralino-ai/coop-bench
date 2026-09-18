// Bounded public HTTPS checks. No new games, player observations, actions or
// artifacts are created; one deliberately unauthorized POST tests buffering.
import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { RemoteSession } from '../desktop/remote-session.mjs';
const base = 'https://coop.neutrinophysics.cn:34935/api/v1';
const owner = readFileSync(new URL('../artifacts/cloud-private/owner.txt', import.meta.url), 'utf8').trim();
assert.match(owner, /^[A-Za-z0-9._~+/-]{24,256}=*$/);
const report = { at: new Date().toISOString(), base, network: 'Windows ordinary domain HTTPS with certificate validation; no SSH relay or DNS override', checks: [] };
const check = (name, actual, expected) => { const passed = actual === expected; report.checks.push({ name, actual, expected, passed }); assert.ok(passed, name); };
function raw(path, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body;
    const req = httpsRequest({ hostname: 'coop.neutrinophysics.cn', port: 34935, servername: 'coop.neutrinophysics.cn', path, method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }), ...options.headers }, timeout: 12000 }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) response.destroy(Error('RESPONSE_LIMIT')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks), tlsVerified: response.socket?.authorized ?? req.socket?.authorized }));
    });
    req.on('timeout', () => req.destroy(Error('REQUEST_TIMEOUT'))); req.on('error', reject); req.end(body);
  });
}
try {
  const health = await raw('/api/v1/health'); check('public-health', health.status, 200); check('TLS-certificate-verified', health.tlsVerified, true);
  const info = JSON.parse(health.bytes); check('service', info.service, 'coop-bench'); report.build = info.build;
  const games = await raw('/api/v1/games'); check('public-catalogue', games.status, 200); check('ten-games', JSON.parse(games.bytes).games.length, 10);
  const store = { load: () => ({ apiUrl: base }), save() {} };
  const session = new RemoteSession({ fetcher: fetch, store });
  const identity = await session.connect({ apiUrl: base, token: owner, remember: false });
  check('desktop-transport-connect', identity.connected, true); check('owner-identity', identity.identity.id, 'owner'); check('operator-role', identity.identity.role, 'operator');
  const privateGet = async path => {
    const response = await session.request({ id: randomUUID(), path: '/api/v1' + path, method: 'GET' });
    check(path.split('?')[0] + '-read', response.status, 200);
    return JSON.parse(new TextDecoder().decode(response.bytes));
  };
  const library = await privateGet('/rollouts?limit=10'); report.savedEpisodes = library.total;
  if (library.items.length) {
    const id = library.items[0].episodeId; assert.match(id, /^[A-Za-z0-9_-]+$/);
    const rollout = await privateGet('/rollouts/' + id);
    report.sample = { episodeId: id, gameId: rollout.summary?.gameId, frameCount: rollout.frames?.length };
    await privateGet('/rollouts/' + id + '/messages?limit=1');
    await privateGet('/rollouts/' + id + '/artifacts');
  }
  for (const path of ['/api/v1/identity', '/api/v1/rollouts']) check(path + '-anonymous-denied', (await raw(path)).status, 401);
  check('wrong-credential-denied', (await raw('/api/v1/identity', { headers: { Authorization: 'Bearer synthetic-invalid-' + randomUUID() } })).status, 401);
  check('spoofed-forwarded-identity-denied', (await raw('/api/v1/rollouts', { headers: { 'X-Forwarded-For': '127.0.0.1', 'X-Forwarded-Host': 'localhost:8788', 'Tailscale-User-Login': 'owner' } })).status, 401);
  for (const origin of ['https://attacker.invalid', 'null', 'https://coop.neutrinophysics.cn:34935']) {
    check('browser-origin-denied-' + origin, (await raw('/api/v1/health', { headers: { Origin: origin } })).status, 403);
  }
  check('wrong-host-denied', (await raw('/api/v1/health', { headers: { Host: 'attacker.invalid:34935' } })).status, 421);
  for (const path of ['/', '/play', '/app.js', '/api/v1/', '/api/v1/play', '/api/v1/app.js', '/api/health', '/health', '/api/v1//health', '/api/v1/%68ealth', '/api/v1/games/../health', '/api/v1/health/']) {
    check('noncanonical-or-page-denied-' + path, (await raw(path)).status, 404);
  }
  check('buffered-44KiB-unauthorized-POST-denied', (await raw('/api/v1/episodes', { body: JSON.stringify({ data: 'x'.repeat(44000) }) })).status, 401);
  check('oversized-POST-denied', (await raw('/api/v1/episodes', { body: JSON.stringify({ data: 'x'.repeat(66000) }) })).status, 413);
  const finalLibrary = await privateGet('/rollouts?limit=1'); check('episode-count-unchanged', finalLibrary.total, library.total);
  session.disconnect(); report.allPassed = true;
} catch (error) { report.allPassed = false; report.error = /^[A-Za-z0-9_. /:?%+-]{1,180}$/.test(error?.message ?? '') ? error.message : 'VALIDATION_FAILED'; process.exitCode = 1; }
finally {
  const text = JSON.stringify(report, null, 2) + '\n'; if (text.includes(owner)) throw Error('SECRET_IN_REPORT');
  writeFileSync(new URL('../artifacts/cloud-api34935-validation.json', import.meta.url), text); console.log(text);
}
