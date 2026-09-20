import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startMockApi } from '../desktop/mock-api.mjs';

test('public mock is loopback-only, labelled synthetic and has no replay/scoring claim', async () => {
  const mock = await startMockApi();
  try {
    assert.equal(new URL(mock.apiUrl).hostname, '127.0.0.1');
    const health = await mock.call('/health'); assert.equal(health.backend, 'mock');
    const denied = await fetch(mock.apiUrl + '/identity'); assert.equal(denied.status, 401);
    const games = await mock.call('/games'); assert.equal(games.games.length, 1); assert.equal(games.games[0].implementation.engine, false);
    const replay = await mock.call(`/episodes/${mock.id}/replay`); assert.equal(replay.verified, null); assert.equal(replay.status, 'synthetic-no-engine');
    const rollout = await mock.call(`/rollouts/${mock.id}`); assert.equal(rollout.frames.length, 5);
    assert.ok(rollout.frames[0].views.p1.view.hands.p1.every(card => !('value' in card) && !('color' in card)));
    const bytes = await fetch(mock.apiUrl + `/rollouts/${mock.id}/artifacts/${mock.artifact.id}/content`, { headers: { Authorization: `Bearer ${mock.adminToken}` } });
    assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), mock.bytes);
  } finally { await mock.close(); await mock.close(); }
});

test('scripted room flow returns one private seat and echoes actual trace uploads', async () => {
  const mock = await startMockApi();
  try {
    const room = await mock.call('/rooms', undefined, { playerCount: 2 });
    const a = randomBytes(32).toString('base64url'), b = randomBytes(32).toString('base64url');
    await mock.call(`/rooms/${room.roomId}/join`, room.inviteToken, { name: 'Synthetic A', playerToken: a });
    await mock.call(`/rooms/${room.roomId}/join`, room.inviteToken, { name: 'Synthetic B', playerToken: b });
    const roster = await mock.call(`/rooms/${room.roomId}`, a);
    assert.equal(roster.playerId, 'p1'); assert.ok(roster.members.every(member => !('token' in member)));
    await mock.call(`/rooms/${room.roomId}/ready`, a, { ready: true });
    await mock.call(`/rooms/${room.roomId}/ready`, b, { ready: true });
    const started = await mock.call(`/rooms/${room.roomId}/start`, a, {}), id = started.episodeId;
    const before = await mock.call(`/episodes/${id}/wait`, a); assert.equal(before.observation.view.hints, 8);
    const after = await mock.call(`/episodes/${id}/actions`, a, { action: { type: 'hint', target: 'p2', kind: 'color', value: 'red' } });
    assert.equal(after.observation.view.hints, 7); assert.equal(after.nextCursor, 1);
    const envelope = { sequence: 0, messageId: 'synthetic-trace', kind: 'tool-call', message: { tool: 'act' } };
    assert.deepEqual(await mock.call(`/episodes/${id}/messages`, a, envelope), envelope);
    const completion = await mock.call(`/episodes/${id}/messages/complete`, a, { completeness: 'partial', scope: 'Synthetic', reasoningAvailability: 'not-provided' });
    assert.equal(completion.lastSequence, 0);
    const audit = await fetch(mock.apiUrl + `/rollouts/${id}`, { headers: { Authorization: `Bearer ${a}` } }); assert.equal(audit.status, 403);
    await mock.call(`/episodes/${id}/truncate`, undefined, {});
    assert.equal((await mock.call(`/episodes/${id}/wait`, a)).observation.status, 'truncated');
  } finally { await mock.close(); }
});
