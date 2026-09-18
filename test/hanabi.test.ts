import test from 'node:test';
import assert from 'node:assert/strict';
import { hanabi } from '../src/games/hanabi.ts';
const setup = () => hanabi.setup({ playerCount: 3, seed: 'hanabi-tests', scenarioId: 'base' });
test('Hanabi fixed 50-card distribution, deterministic setup, private own hand and RNG', () => {
  const s = setup(); assert.deepEqual(s, setup()); assert.equal(s.deck.length, 35);
  const cards = [...s.deck, ...Object.values(s.hands).flatMap(h => h.map(x => x.card))]; assert.equal(cards.length, 50);
  for (const c of ['white', 'red', 'blue', 'yellow', 'green']) assert.deepEqual(cards.filter(x => x.color === c).map(x => x.value).sort(), [1,1,1,2,2,3,3,4,4,5]);
  const v = hanabi.observe(s, 'p1'); assert.ok(v.hands.p1.every(x => !('color' in x) && !('value' in x))); assert.equal(v.hands.p2[0].value, s.hands.p2[0].card.value); assert.ok(!('deck' in v));
  const twin = structuredClone(s); [twin.hands.p1[0].card.color, twin.hands.p1[1].card.color] = [twin.hands.p1[1].card.color, twin.hands.p1[0].card.color];
  twin.hands.p1[0].card.value = twin.hands.p1[0].card.value === 5 ? 1 : 5;
  twin.deck.reverse();
  assert.deepEqual(hanabi.observe(s, 'p1'), hanabi.observe(twin, 'p1'));
  assert.deepEqual(hanabi.legalActions(s, 'p1'), hanabi.legalActions(twin, 'p1'));
  assert.deepEqual(cards.map(c => c.id).sort(), Array.from({ length: 50 }, (_, i) => `c${i}`).sort());
});
test('Hanabi empty hints allowed by selected edition and negative information retained', () => {
  const s = setup(); for (const x of s.hands.p2) x.card.color = 'red';
  const next = hanabi.step(s, 'p1', { type: 'hint', target: 'p2', kind: 'color', value: 'blue' });
  assert.equal(next.hints, 7); assert.deepEqual((next.lastEvent as any).touched, []); assert.ok(next.hands.p2.every(x => !x.colors.includes('blue'))); assert.equal(s.hints, 8);
  assert.throws(() => hanabi.step(s, 'p1', { type: 'discard', index: 0 }));
});
test('Hanabi hints identify every matching slot and all nonmatching slots', () => {
  let s = setup();
  s.hands.p2.forEach((x, i) => { x.card.color = [0, 2, 4].includes(i) ? 'red' : 'blue'; x.card.value = [1, 4].includes(i) ? 3 : 1; });
  s = hanabi.step(s, 'p1', { type: 'hint', target: 'p2', kind: 'color', value: 'red' });
  assert.deepEqual((s.lastEvent as any).touched, [0, 2, 4]);
  s.hands.p2.forEach((x, i) => assert.deepEqual(x.colors, [0, 2, 4].includes(i) ? ['red'] : ['white', 'blue', 'yellow', 'green']));
  s = hanabi.step(s, 'p2', { type: 'hint', target: 'p1', kind: 'color', value: 'white' });
  s = hanabi.step(s, 'p3', { type: 'hint', target: 'p2', kind: 'value', value: 3 });
  assert.deepEqual((s.lastEvent as any).touched, [1, 4]);
  s.hands.p2.forEach((x, i) => assert.deepEqual(x.values, [1, 4].includes(i) ? [3] : [1, 2, 4, 5]));
});
test('Hanabi strict communication rejects out-of-turn, chat, reorder and extra fields without mutation', () => {
  const s = setup(), before = structuredClone(s);
  assert.deepEqual(hanabi.activePlayers(s), ['p1']);
  assert.deepEqual(hanabi.legalActions(s, 'p2'), []);
  assert.ok(hanabi.legalActions(s, 'p1').every(a => ['play', 'discard', 'hint'].includes(a.type)));
  const commands = [
    { player: 'p2', action: { type: 'play', index: 0 } },
    { player: 'p2', action: { type: 'hint', target: 'p1', kind: 'color', value: 'red' } },
    { player: 'p1', action: { type: 'chat', message: 'play index 0' } },
    { player: 'p1', action: { type: 'reorder', order: [4, 3, 2, 1, 0] } },
    { player: 'p2', action: { type: 'reorder', order: [4, 3, 2, 1, 0] } },
    { player: 'p1', action: { type: 'hint', target: 'p2', kind: 'color', value: 'red', message: 'play index 0' } },
    { player: 'p1', action: { type: 'hint', target: 'p2', kind: 'color', value: 'red', touched: [0] } },
    { player: 'p1', action: { type: 'play', index: 0, message: 'play index 1' } },
    { player: 'p1', action: { type: 'hint', target: 'p2', kind: 'value', value: 'red' } },
  ];
  for (const { player, action } of commands) {
    assert.throws(() => hanabi.step(s, player, action));
    assert.deepEqual(s, before);
  }
});
test('Hanabi legal unknown play may fail; third error ends without drawing', () => {
  const s = setup(); s.errors = 2; s.fireworks.red = 2; s.hands.p1[0].card.value = 5;
  const n = hanabi.step(s, 'p1', { type: 'play', index: 0 }); assert.equal(n.deck.length, s.deck.length); assert.equal(n.errors, 3); assert.equal(hanabi.outcome(n)?.reason, 'explosion');
  assert.equal(hanabi.outcome(n)?.kind, 'loss'); assert.equal(hanabi.outcome(n)?.score, 0); assert.equal(hanabi.outcome(n)?.details?.boardScore, 2);
  assert.deepEqual(hanabi.activePlayers(n), []); assert.deepEqual(hanabi.legalActions(n, 'p1'), []);
  assert.throws(() => hanabi.step(n, 'p2', { type: 'play', index: 0 }));
});
test('Hanabi last draw grants exactly one additional turn per player including drawer', () => {
  let s = setup(); s.deck = s.deck.slice(0, 1); s.hints = 7; s.fireworks.red = 2; s.fireworks.blue = 3;
  s = hanabi.step(s, 'p1', { type: 'discard', index: 0 }); assert.equal(s.finalTurns, 3);
  for (const p of ['p2', 'p3', 'p1']) s = hanabi.step(s, p, { type: 'hint', target: p === 'p1' ? 'p2' : 'p1', kind: 'color', value: 'white' });
  assert.equal(s.finalTurns, 0); assert.equal(hanabi.outcome(s)?.kind, 'score-only'); assert.equal(hanabi.outcome(s)?.success, false); assert.equal(hanabi.outcome(s)?.score, 5);
});
test('Hanabi perfect game terminates immediately without drawing', () => {
  let s = setup(); const deckCount = s.deck.length;
  for (const c in s.fireworks) s.fireworks[c] = 5; s.fireworks.red = 4; s.hands.p1[0].card = { id: 'final', color: 'red', value: 5 };
  s = hanabi.step(s, 'p1', { type: 'play', index: 0 }); assert.equal(hanabi.outcome(s)?.score, 25); assert.equal(hanabi.outcome(s)?.success, true); assert.equal(hanabi.outcome(s)?.kind, 'win'); assert.equal(s.deck.length, deckCount); assert.equal(s.hints, 8);
});
