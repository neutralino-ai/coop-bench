/** Scripted, public UI fixtures. This is NOT a game server.
 * No dealing, rules validation, random game state, scoring, or replay engine is
 * implemented here. Values below are invented presentation examples; a command
 * selects the next fixed response. Production always uses the remote API.
 * This fixture listens on an ephemeral loopback port only, when smoke runs.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { REPOSITORY } from './update-client.mjs';

const clone = value => structuredClone(value);
const token = () => randomBytes(32).toString('base64url');
const stamp = '2026-01-01T00:00:00.000Z';
const colors = ['red', 'blue', 'green', 'yellow', 'white'];
const metadata = {
  id: 'hanabi', name: 'Synthetic Hanabi UI fixture', players: [2, 3],
  scenarios: [{ id: 'base', name: 'Synthetic display scenario', description: 'Scripted client acceptance only; not a playable game.' }],
  rulesSummary: ['Synthetic UI fixture: the hint form is populated from a remote JSON schema.', 'No official rules or outcome validation run in this mock.'],
  implementation: { status: 'synthetic-ui-only', engine: false }, sources: [],
};
const actions = [{ type: 'hint', description: 'Synthetic remote hint schema for form acceptance.', schema: { type: 'object',
  properties: { type: { const: 'hint' }, target: { enum: ['p2'] }, kind: { enum: ['color', 'value'] }, value: { enum: ['red', 1] } },
  required: ['type', 'target', 'kind', 'value'] } }, { type: 'play', description: 'Synthetic card-index form.', schema: { type: 'object',
  properties: { type: { const: 'play' }, index: { type: 'integer', minimum: 0, maximum: 4 } }, required: ['type', 'index'] } }];

// Each view is a canned HTTP response. There is no private authority state from
// which a real game could be progressed. Hidden own-card fields are absent.
function view(player, players, hints = 8) {
  return { phase: 'playing', current: hints === 7 ? 'p2' : 'p1', hints, errors: 0, deckCount: 35,
    fireworks: { red: 0, blue: 0, green: 0, yellow: 0, white: 0 }, discards: [],
    hands: Object.fromEntries(players.map((seat, seatIndex) => [seat, colors.map((color, i) => seat === player
      ? { id: `${seat}-card-${i}`, possibleColors: colors, possibleValues: [1, 2, 3, 4, 5] }
      : { id: `${seat}-card-${i}`, color, value: (seatIndex + i) % 5 + 1 })])) };
}
function observation(id, player, players, step = 0, ended = false) {
  return { episodeId: id, playerId: player, observationId: `${id}:${player}:${step}:${ended}`, status: ended ? 'truncated' : 'active',
    decisionToken: 'synthetic-decision-token-not-a-real-capability', updateCursor: step, nextCursor: step, hasMore: false,
    legalActions: ended ? [] : clone(actions), view: view(player, players, step ? 7 : 8), updates: step ? [{ seq: step, kind: ended ? 'truncated' : 'accepted', playerId: 'p1', action: { type: 'hint', target: 'p2', kind: 'color', value: 'red' } }] : [],
    control: { required: !ended && !step, deadlineAt: Date.now() + 60000, windowId: 'synthetic-window', ...(ended ? { endReason: 'synthetic-player-ui-test' } : {}) } };
}
function auditRollout(id, players) {
  const views = hints => Object.fromEntries(players.map(p => [p, { ...observation(id, p, players), view: view(p, players, hints) }]));
  const frames = [{ seq: 0, kind: 'created', at: stamp, views: views(8) }];
  const sequence = [{ type: 'play', index: 0 }, { type: 'hint', target: 'p3', kind: 'value', value: 1 }, { type: 'discard', index: 0 }];
  for (let i = 0; i < sequence.length; i++) frames.push({ seq: i + 1, kind: 'accepted', at: stamp, playerId: players[i % players.length],
    action: sequence[i], observed: clone(frames.at(-1).views[players[i % players.length]]), views: views(i === 1 ? 7 : 8), decisionSummary: '合成测试动作，不是模型推理。' });
  frames.push({ seq: 4, kind: 'truncated', at: stamp, views: views(8) });
  return { schemaVersion: 'coop-bench-rollout-v1', summary: { episodeId: id, gameId: 'hanabi', gameName: metadata.name, scenarioId: 'base',
    playerCount: players.length, status: 'truncated', actionCount: 3, eventCount: 5, coverage: 'recorded', compatibleBuild: true, createdAt: stamp, updatedAt: stamp },
    metadata: clone(metadata), players, frames, annotations: [{ kind: 'review', text: '合成 UI 审计 <img src=x onerror="window.__smokeXss=1">', source: 'admin', createdAt: stamp }] };
}

export async function startMockApi() {
  const adminToken = 'synthetic-owner-' + randomUUID(), id = randomUUID(), rooms = new Map(), episodes = new Map(), requests = [];
  const players = ['p1', 'p2', 'p3'];
  const bytes = Buffer.from('合成桌面附件\n{"fixture":true,"modelInvoked":false}\n');
  const artifact = { id: randomUUID(), name: 'synthetic-client-artifact.jsonl', mediaType: 'application/x-ndjson', kind: 'agent-trace', status: 'complete',
    playerId: 'p1', createdAt: stamp, completedAt: stamp, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), reasoningAvailability: 'not-provided' };
  const completion = { completeness: 'partial', reasoningAvailability: 'not-provided', scope: 'Synthetic UI fixture only', unavailable: ['No real model was invoked.'], lastSequence: 1 };
  const initial = { rollout: auditRollout(id, players), players, step: 0, ended: true, messages: new Map(), completions: new Map([['p1', completion]]), credentials: new Map() };
  initial.messages.set('p1', [
    { sequence: 0, messageId: 'synthetic-ui-message', playerId: 'p1', kind: 'model-input', createdAt: stamp, message: { role: 'user', content: '合成验收消息：仅用于测试客户端，不是模型实局轨迹。' } },
    { sequence: 1, messageId: 'synthetic-linked-reasoning', playerId: 'p1', kind: 'model-output', createdAt: stamp,
      observationId: initial.rollout.frames[1].observed.observationId, reasoningAvailability: 'provided', message: { role: 'assistant',
        reasoning_content: '合成布局测试：这是用于检验长文本展示的虚构内容，没有调用真实模型。'.repeat(25) + '原文结束标记', content: '<img src=x onerror="window.__thinkingXss=1">' } },
  ]);
  episodes.set(id, initial);
  let password, sessionToken, updateOpened = false, closed = false;
  const identity = { id: 'owner', role: 'operator', retention: { policy: 'synthetic-only' } };
  const updateBytes = Buffer.from('Synthetic updater fixture; never execute.'), updateDigest = createHash('sha256').update(updateBytes).digest('hex');
  const suffix = process.platform === 'darwin' ? `mac-${process.arch}.dmg` : 'win-x64.exe', updateName = `Coop-Bench-99.0.0-${suffix}`;
  const respond = (res, value, status = 200, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(value)); };
  const fail = (res, status, code) => respond(res, { error: { code, message: 'Synthetic mock response: ' + code } }, status);
  const isAdmin = credential => credential === adminToken || Boolean(sessionToken && credential === sessionToken);
  const memberFor = (room, credential) => room.members.find(m => m.token === credential);
  const roomView = (room, credential, invite = false) => ({ roomId: room.roomId, gameId: 'hanabi', scenarioId: 'base', playerCount: room.playerCount,
    name:room.name,decisionTimeoutSeconds:room.decisionTimeoutSeconds,allowHumans:room.allowHumans,expiresAt:Date.now()+600000,
    status: room.status, episodeId: room.episodeId, rosterVersion: room.rosterVersion, hostPlayerId: room.members[0]?.playerId ?? null,
    ...(memberFor(room, credential) ? { playerId: memberFor(room, credential).playerId } : {}),
    members: room.members.map(({ token: _private, ...member }) => clone(member)), ...(invite ? { inviteToken: room.inviteToken } : {}) });
  const makeEpisode = (count, credentials = new Map(), name) => {
    const episodeId = randomUUID(), seats = Array.from({ length: count }, (_, i) => ({ playerId: `p${i + 1}`, token: token() }));
    if (!credentials.size) for (const seat of seats) credentials.set(seat.token, seat.playerId);
    const players = seats.map(s => s.playerId);
    const rollout=auditRollout(episodeId,players);rollout.summary.status='active';rollout.frames=rollout.frames.filter(f=>f.kind!=='truncated');if(name)rollout.summary.name=name;
    episodes.set(episodeId, { rollout, players, step: 0, ended: false, messages: new Map(), completions: new Map(), credentials });
    return { episodeId, gameId: 'hanabi', scenarioId: 'base', seats };
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1'), path = url.pathname.replace(/^\/api\/v1/, ''), credential = req.headers.authorization?.replace(/^Bearer /, '');
      let body; const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 256 * 1024) return fail(res, 413, 'MOCK_PAYLOAD_LIMIT'); chunks.push(chunk); }
      if (chunks.length) { try { body = JSON.parse(Buffer.concat(chunks)); } catch { return fail(res, 400, 'INVALID_JSON'); } }
      requests.push({ method: req.method, path: url.pathname, body: clone(body) });
      if (path === '/_mock/update/release') return respond(res, { tag_name: 'v99.0.0', draft: false, prerelease: false, html_url: `${REPOSITORY}/releases/tag/v99.0.0`,
        assets: [{ name: updateName, size: updateBytes.length, digest: `sha256:${updateDigest}`, browser_download_url: `${REPOSITORY}/releases/download/v99.0.0/${updateName}` }] });
      if (path === '/_mock/update/redirect') { res.writeHead(302, { Location: 'https://release-assets.githubusercontent.com/synthetic-installer' }); return res.end(); }
      if (path === '/_mock/update/content') return res.end(updateBytes);
      if(path==='/model/chat/completions'){if(credential!=='synthetic-provider-key')return fail(res,401,'MODEL_AUTH');return respond(res,{choices:[{message:{role:'assistant',tool_calls:[{id:'synthetic-call',type:'function',function:{name:'act',arguments:JSON.stringify({actionJson:JSON.stringify({type:'hint',target:'p2',kind:'color',value:'red'})})}}]}}]});}
      if (!url.pathname.startsWith('/api/v1/')) return fail(res, 404, 'MOCK_ROUTE_NOT_FOUND');
      if (path === '/health') return respond(res, { ok: true, service: 'coop-bench', apiVersion: 'v1', backend: 'mock' });
      if (path === '/games') return respond(res, { games: [metadata] });
      if (path === '/games/hanabi') return respond(res, metadata);
      if (path === '/auth/login' && req.method === 'POST') {
        if (!password || body?.userId !== 'owner' || body.password !== password) return fail(res, 401, 'INVALID_PASSWORD');
        sessionToken = 'hs1_' + token(); return respond(res, { token: sessionToken, identity, expiresAt: new Date(Date.now() + 3600000).toISOString() });
      }
      if (path === '/identity') return isAdmin(credential) ? respond(res, identity) : fail(res, 401, 'UNAUTHORIZED');
      if (path.startsWith('/auth/')) {
        if (!isAdmin(credential)) return fail(res, 401, 'UNAUTHORIZED');
        if (path === '/auth/account') return respond(res, { userId: 'owner', role: 'operator', passwordConfigured: Boolean(password), authentication: credential.startsWith('hs1_') ? 'password-session' : 'personal-token' });
        if (path === '/auth/password') { password = body.password; sessionToken = 'hs1_' + token(); return respond(res, { token: sessionToken, identity, expiresAt: new Date(Date.now() + 3600000).toISOString() }); }
        if (path === '/auth/logout') { sessionToken = undefined; return respond(res, { ok: true }); }
      }
      if (path === '/lobby' && req.method === 'GET') {
        if (!isAdmin(credential)) return fail(res,401,'UNAUTHORIZED');
        return respond(res,{rooms:[...rooms.values()].filter(r=>r.allowHumans&&r.status==='waiting'&&r.members.length<r.playerCount).map(r=>roomView(r,credential))});
      }
      const lobbyJoin=path.match(/^\/lobby\/([^/]+)\/join$/);
      if(lobbyJoin&&req.method==='POST'){
        if(!isAdmin(credential))return fail(res,401,'UNAUTHORIZED');
        const room=rooms.get(lobbyJoin[1]);if(!room)return fail(res,404,'NOT_FOUND');
        let member=memberFor(room,body.playerToken);
        if(!member){
          if(!room.allowHumans)return fail(res,403,'FORBIDDEN');
          if(room.status!=='waiting')return fail(res,409,'ROOM_CLOSED');
          if(room.members.length>=room.playerCount)return fail(res,409,'ROOM_FULL');
          const issued=room.seatTokens?.find(s=>s.seatToken===body.playerToken);if(!issued)return fail(res,409,'INVALID_SEAT_TOKEN');
          member={playerId:issued.playerId,name:body.name,ready:false,token:body.playerToken};room.members.push(member);room.rosterVersion++;room.members.forEach(m=>m.ready=false);
        }
        return respond(res,roomView(room,body.playerToken));
      }
      if (path === '/rooms') {
        if (!isAdmin(credential)) return fail(res, 401, 'UNAUTHORIZED');
        if (req.method === 'GET') return respond(res, { rooms: [...rooms.values()].map(r => roomView(r, credential)) });
        const room = { roomId: randomUUID(), playerCount: body.playerCount, allowHumans:body.allowHumans===true, name:body.name,decisionTimeoutSeconds:body.decisionTimeoutSeconds??600,status: 'waiting', episodeId: null, rosterVersion: 0, members: [], inviteToken: token() };
        room.seatTokens=room.allowHumans?Array.from({length:room.playerCount},(_,i)=>({playerId:`p${i+1}`,seatToken:token()})):[];
        rooms.set(room.roomId, room); return respond(res, {...roomView(room, credential, true),...(room.allowHumans?{seatTokens:room.seatTokens}:{})});
      }
      let match = path.match(/^\/rooms\/([^/]+)(?:\/([^/]+))?$/);
      if (match) {
        const room = rooms.get(match[1]), operation = match[2]; if (!room) return fail(res, 404, 'UNKNOWN_ROOM');
        if (operation === 'join') {
          if (credential !== room.inviteToken && !(room.allowHumans&&credential===body.playerToken)) return fail(res, 401, 'INVALID_INVITE');
          let member = memberFor(room, body.playerToken);
          if (!member) { if(room.status!=='waiting')return fail(res,409,'ROOM_CLOSED');const issued=room.seatTokens?.find(s=>s.seatToken===body.playerToken);if(room.allowHumans&&!issued)return fail(res,409,'INVALID_SEAT_TOKEN');member = { playerId: issued?.playerId??`p${room.members.length + 1}`, name: body.name, ready: false, token: body.playerToken }; room.members.push(member); room.rosterVersion++; room.members.forEach(m => m.ready = false); }
          return respond(res, roomView(room, body.playerToken));
        }
        const member = memberFor(room, credential);
        if (!isAdmin(credential) && !member) return fail(res, 401, 'UNAUTHORIZED');
        if (operation?.startsWith('admin') && !isAdmin(credential)) return fail(res, 403, 'ADMIN_ONLY');
        if(operation==='admin-seat-tokens'){const seatTokens=room.seatTokens.filter(s=>!room.members.some(m=>m.playerId===s.playerId)&&(!body.playerId||body.playerId===s.playerId)).map(s=>({...s,seatToken:token()}));room.seatTokens=room.seatTokens.map(s=>seatTokens.find(k=>k.playerId===s.playerId)??s);return respond(res,{roomId:room.roomId,seatTokens});}
        if (['invite', 'admin-invite'].includes(operation)) { room.inviteToken = token(); return respond(res, roomView(room, credential, true)); }
        if (operation === 'ready') member.ready = body.ready;
        if(operation==='admin-kick'){room.members=room.members.filter(m=>m.playerId!==body.playerId);room.seatTokens=room.seatTokens.map(s=>s.playerId===body.playerId?{...s,seatToken:null}:s);room.rosterVersion++;room.members.forEach(m=>m.ready=false);}
        if (operation === 'leave'){room.members=room.members.filter(m=>m!==member);room.rosterVersion++;room.members.forEach(m=>m.ready=false);}
        if (['start', 'admin-start'].includes(operation)) { const next = makeEpisode(room.playerCount, new Map(room.members.map(m => [m.token, m.playerId])),room.name); room.episodeId = next.episodeId; room.status = 'active'; }
        return respond(res, roomView(room, credential));
      }
      if (path === '/episodes' && req.method === 'POST') return isAdmin(credential) ? respond(res, makeEpisode(body.playerCount,new Map(),body.name)) : fail(res, 401, 'UNAUTHORIZED');
      if (path === '/rollouts') return isAdmin(credential) ? respond(res, { items: [...episodes.values()].map(e => e.rollout.summary), total: episodes.size }) : fail(res, 401, 'UNAUTHORIZED');
      match = path.match(/^\/(rollouts|episodes)\/([^/]+)(?:\/(.*))?$/);
      if (!match) return fail(res, 404, 'MOCK_ROUTE_NOT_FOUND');
      const [, category, episodeId, operation] = match, episode = episodes.get(episodeId);
      if (!episode) return fail(res, 404, 'UNKNOWN_EPISODE');
      const player = episode.credentials.get(credential), admin = isAdmin(credential);
      if (!admin && !player) return fail(res, 401, 'UNAUTHORIZED');
      if (category === 'rollouts') {
        if (!admin) return fail(res, 403, 'AUDIT_FORBIDDEN');
        if (!operation) return respond(res, episode.rollout);
        if (operation === 'messages') {
          const seat = url.searchParams.get('playerId');
          if (!seat) return respond(res, { seats: episode.players.map(playerId => ({ playerId, messageCount: episode.messages.get(playerId)?.length ?? 0, completion: episode.completions.get(playerId) ?? null })) });
          const messages = (episode.messages.get(seat) ?? []).filter(m => m.sequence > Number(url.searchParams.get('after') ?? -1));
          return respond(res, { messages, nextAfter: messages.at(-1)?.sequence ?? -1, hasMore: false, completion: episode.completions.get(seat) ?? null });
        }
        if (operation === 'artifacts') return respond(res, { artifacts: episodeId === id ? [artifact] : [] });
        if (operation === `artifacts/${artifact.id}/content` && episodeId === id) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(bytes); }
        if (operation === 'annotations') { episode.rollout.annotations.push({ ...body, source: 'admin', createdAt: stamp }); return respond(res, { ok: true }); }
      }
      if (operation === 'replay' && admin) return respond(res, { status: 'synthetic-no-engine', verified: null, note: 'Client response rendering only; no deterministic replay or scoring is performed.' });
      if (operation === 'truncate' && admin) { episode.ended = true; episode.rollout.summary.status='truncated'; episode.step++; return respond(res, { ok: true }); }
      if (operation === 'rules' && player) return respond(res, metadata);
      if (operation === 'messages' && player) { const messages = episode.messages.get(player) ?? []; messages.push({ ...body, playerId: player, createdAt: stamp }); episode.messages.set(player, messages); return respond(res, body); }
      if (operation === 'messages/complete' && player) { const complete = { ...body, lastSequence: (episode.messages.get(player)?.length ?? 0) - 1 }; episode.completions.set(player, complete); return respond(res, complete); }
      if (['observation', 'wait', 'actions'].includes(operation) && player) {
        if (operation === 'actions') {
          // A single expected HTTP example, not legal-move validation.
          assert.deepEqual(body.action, { type: 'hint', target: 'p2', kind: 'color', value: 'red' }); episode.step = 1;
        }
        if (operation === 'wait') await new Promise(resolve => setTimeout(resolve, 100));
        const snapshot = observation(episodeId, player, episode.players, episode.step, episode.ended);
        return respond(res, operation === 'observation' ? snapshot : { observation: snapshot, nextCursor: snapshot.nextCursor, hasMore: false, serverTime: Date.now() });
      }
      return fail(res, 404, 'MOCK_ROUTE_NOT_FOUND');
    } catch (error) { if (!res.headersSent) fail(res, 500, 'MOCK_FIXTURE_ASSERTION'); else res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`, apiUrl = baseUrl + '/api/v1';
  return { backend: 'mock', baseUrl, apiUrl, adminToken, id, bytes, artifact, requests,
    async call(path, credential = adminToken, body) { const response = await fetch(apiUrl + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${credential}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const value = await response.json(); assert.ok(response.ok, `Mock HTTP ${response.status}: ${JSON.stringify(value)}`); return value; },
    wrapUpdateFetch: fetcher => (url, options) => { const host = new URL(url).hostname, route = host === 'api.github.com' ? 'release' : host === 'github.com' ? 'redirect' : host === 'release-assets.githubusercontent.com' ? 'content' : null;
      assert.ok(route, 'Unexpected updater host'); return fetcher(`${baseUrl}/_mock/update/${route}`, options); },
    async openUpdate(path) { assert.deepEqual(readFileSync(path), updateBytes); updateOpened = true; return ''; }, updateOpened: () => updateOpened,
    async close() { if (closed) return; closed = true; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
