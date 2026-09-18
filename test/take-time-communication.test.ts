import test from 'node:test';
import assert from 'node:assert/strict';
import { takeTime } from '../src/games/take-time.ts';
import { Authority } from '../src/authority.ts';
import { createApi } from '../src/server.ts';
import { PlayerClient } from '../src/player-client.ts';

test('Take Time discussion exposes all seat back colors without values, IDs or seeds, for 2–4 players', () => {
  for (const playerCount of [2, 3, 4]) {
    const state = takeTime.setup({ playerCount, scenarioId: 'official-clock-1-1', seed: `discussion-secret-${playerCount}` });
    const playerIds = Array.from({ length: playerCount }, (_, i) => `p${i + 1}`);
    const before = takeTime.observe(state, 'p1');
    const handSize = playerCount === 2 ? 4 : 12 / playerCount;
    for (const observerId of playerIds) {
      const view = takeTime.observe(state, observerId);
      assert.equal(view.hand, null);
      assert.equal(view.phase, 'discussion');
      assert.equal(view.currentPlayerId, null);
      assert.deepEqual(view.cardColorCounts, before.cardColorCounts);
      for (const id of playerIds) {
        const { hand, reserve } = view.cardColorCounts[id];
        assert.equal(hand.solar + hand.lunar, handSize);
        assert.equal(reserve.solar + reserve.lunar, playerCount === 2 ? 2 : 0);
        assert.ok(view.cardBacks[id].hand.every((color: string) => ['solar', 'lunar'].includes(color)));
      }
      assert.ok(!JSON.stringify(view).includes(state.seed));
      // Only public rules have an id; dealt-card identities and values are absent.
      const { rules: _, ...actualView } = view;
      assert.ok(!JSON.stringify(actualView).includes('"id"'));
      assert.ok(!JSON.stringify(actualView).includes('"value"'));
    }
    const looked = takeTime.step(state, 'p1', { type: 'look_hand' });
    const own = takeTime.observe(looked, 'p1');
    assert.equal(own.hand.length, handSize);
    assert.equal(own.hand.filter((card: any) => card.color === 'solar').length, before.cardColorCounts.p1.hand.solar);
    assert.equal(takeTime.observe(looked, 'p2').hand, null);
    assert.deepEqual(takeTime.observe(looked, 'p2').cardColorCounts, before.cardColorCounts);
    for (const card of own.hand) assert.ok(!JSON.stringify(takeTime.observe(looked, 'p2')).includes(card.id));
  }
});

test('public color counts follow hidden placements and two-player reserve pickup, without exposing values', () => {
  let state = takeTime.setup({ playerCount: 2, scenarioId: 'official-clock-1-1', seed: 'color-reserves' });
  const initial = takeTime.observe(state, 'p1');
  for (const id of ['p1', 'p2']) state = takeTime.step(state, id, { type: 'look_hand' });
  const played: Record<string, { solar: number; lunar: number }> = { p1: { solar: 0, lunar: 0 }, p2: { solar: 0, lunar: 0 } };
  for (let i = 0; i < 4; i++) {
    const playerId = i % 2 === 0 ? 'p1' : 'p2', otherId = playerId === 'p1' ? 'p2' : 'p1';
    const card = takeTime.observe(state, playerId).hand[0];
    played[playerId][card.color as 'solar' | 'lunar']++;
    state = takeTime.step(state, playerId, { type: 'place', cardId: card.id, position: 6, faceUp: false });
    const other = takeTime.observe(state, otherId);
    assert.equal(other.placements.at(-1).value, null);
    assert.equal(other.placements.at(-1).color, card.color);
    assert.ok(!JSON.stringify(other).includes(card.id));
    for (const id of ['p1', 'p2']) {
      for (const color of ['solar', 'lunar']) {
        assert.equal(other.cardColorCounts[id].hand[color], initial.cardColorCounts[id].hand[color] - played[id][color as 'solar' | 'lunar']
          + (i === 3 ? initial.cardColorCounts[id].reserve[color] : 0));
        assert.equal(other.cardColorCounts[id].reserve[color], i === 3 ? 0 : initial.cardColorCounts[id].reserve[color]);
      }
    }
  }
});

test('three independent HTTP clients discuss out of order, catch up with cursors, and become silent individually', async () => {
  const authority = new Authority(':memory:', [takeTime], 'take-time-discussion-api-test');
  const server = createApi(authority, 'coordinator-take-time-communication-test');
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;
  try {
    const created = authority.create('take-time', { playerCount: 3, scenarioId: 'official-clock-1-1', seed: 'three-independent-clients' });
    const clients = created.seats.map(seat => new PlayerClient(base, created.episodeId, seat.token));
    const initial = await clients[0].observe();
    const stale = clients[0].prepare({ type: 'speak', text: 'Based on an obsolete observation.' });
    await clients[2].observe();
    for (const text of ['First position requires one solar card.', 'We can reserve three cards for position six.']) {
      const prepared = clients[2].prepare({ type: 'speak', text });
      const accepted = await clients[2].submit(prepared);
      assert.equal(accepted.httpStatus, 200);
      assert.deepEqual(await clients[2].submit(prepared), accepted);
    }
    const rejected = await clients[0].submit(stale);
    assert.equal(rejected.httpStatus, 409);
    assert.equal(rejected.error.code, 'STALE_OBSERVATION');
    const caughtUp = await clients[0].observe();
    assert.ok(caughtUp.updateCursor! > initial.updateCursor!);
    assert.deepEqual(caughtUp.view.discussion.map((message: any) => message.playerId), ['p3', 'p3']);
    assert.ok(caughtUp.updates!.some(update => update.view.discussion.length === 1));
    assert.ok(caughtUp.updates!.every(update => typeof update.preparedAt === 'string'));
    assert.equal(caughtUp.view.hand, null);
    assert.equal((await clients[0].submit(clients[0].prepare({ type: 'speak', text: 'Agreed before looking.' }))).httpStatus, 200);
    await clients[1].observe();
    assert.equal((await clients[1].submit(clients[1].prepare({ type: 'look_hand' }))).httpStatus, 200);
    assert.equal((await clients[1].submit(clients[1].prepare({ type: 'speak', text: 'Forbidden once I saw my numbers.' }))).httpStatus, 409);
    await clients[2].observe();
    const stillDiscussing = await clients[2].submit(clients[2].prepare({ type: 'speak', text: 'I have not looked, so I can still discuss.' }));
    assert.equal(stillDiscussing.httpStatus, 200);
    assert.equal(stillDiscussing.observation.view.hand, null);
    await clients[0].observe();
    assert.equal((await clients[0].submit(clients[0].prepare({ type: 'look_hand' }))).httpStatus, 200);
    await clients[2].observe();
    const lastLook = await clients[2].submit(clients[2].prepare({ type: 'look_hand' }));
    assert.equal(lastLook.observation.view.phase, 'playing');
    assert.deepEqual(lastLook.observation.view.activePlayerIds, ['p1', 'p2', 'p3']);
    const firstCard = lastLook.observation.view.hand[0];
    assert.equal((await clients[2].submit(clients[2].prepare({ type: 'place', cardId: firstCard.id, position: 6 }))).httpStatus, 200);
    const firstPlayer = await clients[0].observe();
    assert.equal(firstPlayer.view.currentPlayerId, 'p1');
    assert.equal(firstPlayer.view.placements[0].value, null);
    assert.equal((await clients[0].submit(clients[0].prepare({ type: 'speak', text: 'Forbidden in play.' }))).httpStatus, 409);
    authority.truncate(created.episodeId, 'communication contract test completed');
    const audit = authority.audit(created.episodeId);
    const messages = audit.events.filter((event: any) => event.kind === 'accepted' && event.payload.command.action.type === 'speak');
    assert.equal(messages.length, 4);
    assert.ok(messages.every((event: any) => event.player_id && event.received_at));
    assert.equal(authority.verifyReplay(created.episodeId).valid, true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    authority.close();
  }
});
