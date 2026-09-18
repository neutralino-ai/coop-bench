import test from 'node:test';
import assert from 'node:assert/strict';
import { bombBusters as game, type BombState } from '../src/games/bomb-busters.ts';
import type { Action } from '../src/types.ts';

const setup = (playerCount = 4, seed = 'bomb-test') => game.setup({ playerCount, seed, scenarioId: 'official-mission-1' });
const all = (s: BombState) => s.stands.flatMap(stand => stand.wires);
const hand = (s: BombState, player: string) => s.stands.filter(stand => stand.owner === player).flatMap(stand => stand.wires).filter(wire => !wire.cut);
const examples = (s: BombState, player = s.current, type?: string) => game.legalActions(s, player).filter(action => action.type !== 'chat' && (!type || action.type === type)).flatMap(action => action.examples ?? []);
function initialized(count = 4, seed = 'bomb-test'): BombState {
  let s = setup(count, seed);
  while (s.phase === 'initial-info') s = game.step(s, s.current, examples(s)[0]);
  return s;
}
function fixture(hands: number[][], cutValues: number[] = []): BombState {
  const s = setup(hands.length); s.phase = 'cut'; s.current = 'p1'; s.captain = 'p1'; s.initialInfo = [...s.players];
  s.stands = hands.map((values, i) => ({ id: `stand-${i + 1}`, owner: s.players[i], wires: values.toSorted((a, b) => a - b).map((value, index) => ({ id: `p${i + 1}-${index}`, value, cut: false, info: false })) }));
  if (cutValues.length) s.stands[0].wires.push(...cutValues.map((value, i) => ({ id: `cut-${i}`, value, cut: true, info: false })));
  s.cuts = cutValues.length;
  return s;
}

test('Mission 1 has 24 wires, separately sorted stands and exact 2–5 player setup', () => {
  for (const count of [2, 3, 4, 5]) {
    const s = setup(count); assert.deepEqual(s, setup(count));
    assert.equal(s.mistakeLimit, count); assert.equal(all(s).length, 24);
    assert.equal(new Set(all(s).map(wire => wire.id)).size, 24);
    for (const value of [1, 2, 3, 4, 5, 6]) assert.equal(all(s).filter(wire => wire.value === value).length, 4);
    for (const p of s.players) assert.equal(s.stands.filter(stand => stand.owner === p).length, count === 2 || (count === 3 && p === s.captain) ? 2 : 1);
    assert.deepEqual(s.stands.map(stand => stand.wires.length), count === 5 ? [5, 5, 5, 5, 4] : [6, 6, 6, 6]);
    for (const stand of s.stands) assert.deepEqual(stand.wires.map(wire => wire.value), stand.wires.map(wire => wire.value).toSorted((a, b) => a - b));
    assert(!JSON.stringify(game.observe(s, s.players[0])).includes('seed'));
  }
  assert.throws(() => game.setup({ playerCount: 1, seed: 'x', scenarioId: 'official-mission-1' }));
  assert.throws(() => game.setup({ playerCount: 4, seed: 'x', scenarioId: 'official-mission-2' }));
  assert.throws(() => game.setup({ playerCount: 4, seed: 'x', scenarioId: 'official-mission-1', config: { difficulty: 'easy' } }));
});

test('captain starts clockwise one-clue-per-player setup, including only one clue for two stands', () => {
  let s = setup(3); const order: string[] = [];
  const other = s.players.find(p => p !== s.current)!;
  assert.throws(() => game.step(s, other, { type: 'place_info', wireId: hand(s, other)[0].id }));
  assert.throws(() => game.step(s, s.current, { type: 'place_info', wireId: hand(s, other)[0].id }));
  assert.throws(() => game.step(s, s.current, { type: 'solo_cut', value: 1 }));
  while (s.phase === 'initial-info') { order.push(s.current); s = game.step(s, s.current, examples(s)[0]); }
  assert.equal(order.length, 3); assert.equal(new Set(order).size, 3); assert.equal(order[0], s.captain);
  assert.equal(s.current, s.captain); assert.equal(all(s).filter(wire => wire.info).length, 3);
  assert.throws(() => game.step(s, s.current, { type: 'place_info', wireId: hand(s, s.current)[0].id }));
});

test('dual cut requires a held value, preserves failed actor position privacy and advances only after own successful cut', () => {
  let s = fixture([[1, 1, 2], [1, 2, 3], [4], [5]]);
  const original = structuredClone(s);
  assert.throws(() => game.step(s, 'p1', { type: 'dual_cut', wireId: 'p2-0', value: 6 }));
  assert.throws(() => game.step(s, 'p2', { type: 'dual_cut', wireId: 'p1-0', value: 1 }));
  assert.deepEqual(s, original);
  s = game.step(s, 'p1', { type: 'dual_cut', wireId: 'p2-0', value: 1 });
  assert.equal(s.phase, 'self-cut'); assert.equal(s.current, 'p1'); assert.equal(s.cuts, 1);
  assert.equal(examples(s, 'p1', 'finish_cut').length, 2);
  s = game.step(s, 'p1', { type: 'finish_cut', wireId: 'p1-1' });
  assert.equal(s.current, 'p2'); assert.equal(s.cuts, 2); assert.equal(s.phase, 'cut');
  s = game.step(s, 'p2', { type: 'dual_cut', wireId: 'p1-0', value: 2 });
  assert.equal(s.current, 'p3'); assert.equal(s.mistakes, 1); assert.equal(s.cuts, 2);
  assert.equal(s.lastEvent!.guessedValue, 2); assert.equal(s.lastEvent!.actualValue, 1);
  const view = game.observe(s, 'p3');
  assert.equal(view.stands[1].wires.find((wire: any) => wire.id === 'p2-1').value, undefined);
  assert.equal(view.stands[0].wires.find((wire: any) => wire.id === 'p1-0').value, 1);
  assert.equal(view.pending, null);
});

test('solo cut requires all remaining 2 or 4 copies, with two stands treated as one hand', () => {
  let s = fixture([[1, 1, 1], [1], [2], [3]]);
  assert(!examples(s, 'p1', 'solo_cut').length);
  assert.throws(() => game.step(s, 'p1', { type: 'solo_cut', value: 1 }));
  s = fixture([[1, 1], [1, 1], [2], [3]]);
  assert.throws(() => game.step(s, 'p1', { type: 'solo_cut', value: 1 }));
  s = fixture([[1, 1], [2], [3], [4]], [1, 1]);
  const moved = s.stands[0].wires.shift()!;
  s.stands.push({ id: 'extra', owner: 'p1', wires: [moved] });
  s = game.step(s, 'p1', { type: 'solo_cut', value: 1 }); assert.equal(s.cuts, 4);
  assert(game.observe(s, 'p2').validation.includes(1));
  s = fixture([[1, 1, 1, 1], [2], [3], [4]]);
  s = game.step(s, 'p1', { type: 'solo_cut', value: 1 }); assert.equal(s.cuts, 4); assert.equal(s.current, 'p2');
});

test('Double Detector permits nonadjacent positions only on one teammate stand and has private responder choice', () => {
  let s = fixture([[1, 1, 2], [1, 1, 3], [2, 3], [4, 4]]);
  assert.throws(() => game.step(s, 'p1', { type: 'double_detector', wireIds: ['p2-0', 'p3-0'], value: 1 }));
  assert.throws(() => game.step(s, 'p1', { type: 'double_detector', wireIds: ['p2-0', 'p2-0'], value: 1 }));
  s = game.step(s, 'p1', { type: 'double_detector', wireIds: ['p2-0', 'p2-2'], value: 1 });
  assert.equal(s.phase, 'detector-response'); assert.equal(s.detectorUsed.p1, true);
  assert.deepEqual(examples(s, 'p2', 'detector_response'), [{ type: 'detector_response', wireId: 'p2-0' }]);
  assert.throws(() => game.step(s, 'p2', { type: 'detector_response', wireId: 'p2-2' }));
  assert.throws(() => game.step(s, 'p1', { type: 'detector_response', wireId: 'p2-0' }));
  s = game.step(s, 'p2', { type: 'detector_response', wireId: 'p2-0' });
  assert.equal(s.phase, 'self-cut'); s = game.step(s, 'p1', examples(s, 'p1')[0]);
  s.current = 'p1';
  assert.throws(() => game.step(s, 'p1', { type: 'double_detector', wireIds: ['p2-1', 'p2-2'], value: 1 }));

  const a = fixture([[1], [1, 1], [2], [3]]); const b = structuredClone(a); b.stands[1].wires[1].value = 2;
  const request: Action = { type: 'double_detector', wireIds: ['p2-0', 'p2-1'], value: 1 };
  const aa = game.step(a, 'p1', request), bb = game.step(b, 'p1', request);
  assert.equal(examples(aa, 'p2').length, 2); assert.equal(examples(bb, 'p2').length, 1);
  assert.deepEqual(game.observe(aa, 'p1'), game.observe(bb, 'p1'));
  const response: Action = { type: 'detector_response', wireId: 'p2-0' };
  assert.deepEqual(game.observe(game.step(aa, 'p2', response), 'p1'), game.observe(game.step(bb, 'p2', response), 'p1'));
});

test('failed detector lets responder choose the single disclosed wire and costs one dial step', () => {
  let s = fixture([[1], [2, 3], [4], [5]]);
  s = game.step(s, 'p1', { type: 'double_detector', wireIds: ['p2-0', 'p2-1'], value: 1 });
  assert.equal(examples(s, 'p2').length, 2);
  s = game.step(s, 'p2', { type: 'detector_response', wireId: 'p2-1' });
  assert.equal(s.mistakes, 1); assert.equal(s.cuts, 0); assert.equal(s.current, 'p2');
  assert.equal(game.observe(s, 'p1').stands[1].wires[0].value, undefined);
  assert.equal(game.observe(s, 'p1').stands[1].wires[1].value, 3);
});

test('two Info tokens per value: shortage announces once and cut-token capacity is reusable', () => {
  let s = fixture([[1], [2, 2, 2, 2], [3], [4]]);
  s.stands[1].wires[0].info = true; s.stands[1].wires[1].info = true;
  s = game.step(s, 'p1', { type: 'dual_cut', wireId: 'p2-2', value: 1 });
  assert.equal(s.lastEvent!.actualValue, 2); assert.equal(s.lastEvent!.hasInfoToken, false);
  assert.equal(game.observe(s, 'p3').stands[1].wires[2].value, undefined);
  assert.equal(game.observe(s, 'p3').infoTokensAvailable[2], 0);
  s.stands[1].wires[0].cut = true; s.stands[1].wires[0].info = false; s.cuts++;
  s.current = 'p1'; s = game.step(s, 'p1', { type: 'dual_cut', wireId: 'p2-3', value: 1 });
  assert.equal(s.lastEvent!.hasInfoToken, true); assert.equal(s.stands[1].wires[3].info, true);
});

test('dial skull occurs on the player-count-th error, without disclosing final failed wire value', () => {
  for (const count of [2, 3, 4, 5]) {
    let s = fixture(Array.from({ length: count }, (_, i) => [i + 1]));
    for (let i = 0; i < count; i++) {
      s.current = 'p1'; s = game.step(s, 'p1', { type: 'dual_cut', wireId: 'p2-0', value: 1 });
      assert.equal(Boolean(s.result), i + 1 === count);
    }
    assert.equal(game.outcome(s)!.success, false); assert.equal(s.lastEvent!.actualValue, undefined);
    assert.deepEqual(game.activePlayers(s), []); assert.deepEqual(game.legalActions(s, 'p1'), []);
  }
});

test('opponent unmarked values cannot affect observation or offered guesses; empty seats are skipped', () => {
  const a = fixture([[1, 2], [1, 3], [2, 3], [4, 4]]), b = structuredClone(a);
  b.stands[1].wires[0].value = 2; b.stands[2].wires[0].value = 1;
  assert.deepEqual(game.observe(a, 'p1'), game.observe(b, 'p1'));
  assert.deepEqual(game.legalActions(a, 'p1'), game.legalActions(b, 'p1'));
  assert(examples(a, 'p1', 'dual_cut').some(action => action.wireId === 'p2-0' && action.value === 2));
  let s = fixture([[1, 1, 1, 1], [], [2, 2, 2, 2], []]);
  s = game.step(s, 'p1', { type: 'solo_cut', value: 1 }); assert.equal(s.current, 'p3');
});

test('all offered actions execute immutably; seeded legal play terminates; omniscient mechanical oracle cuts all 24', () => {
  let losses = 0, wins = 0;
  for (const count of [2, 3, 4, 5]) for (let run = 0; run < 12; run++) {
    let s = initialized(count, `run-${run}`); let steps = 0;
    while (!game.outcome(s)) {
      const actor = game.activePlayers(s)[0], choices = examples(s, actor), before = structuredClone(s);
      assert(choices.length, `${s.phase} needs a gameplay action`);
      if (run === 0 && steps < 3) for (const action of choices) { assert.doesNotThrow(() => game.step(s, actor, action)); assert.deepEqual(s, before); }
      const action = choices[(run + steps * 17) % choices.length], previous = s;
      s = game.step(s, actor, action); assert.deepEqual(previous, before); assert(++steps < 100);
    }
    if (s.result!.success) wins++; else losses++;
    // Oracle is a rule-transition test, never an agent policy or evaluation score.
    s = initialized(count, `oracle-${run}`); steps = 0;
    while (!s.result) {
      const actor = game.activePlayers(s)[0], choices = examples(s, actor);
      const action = s.phase !== 'cut' ? choices[0] : choices.find(action => action.type === 'solo_cut') ?? choices.find(action => action.type === 'dual_cut' && all(s).find(wire => wire.id === action.wireId)!.value === action.value);
      assert(action); const before = structuredClone(s); const previous = s;
      s = game.step(s, actor, action); assert.deepEqual(previous, before); assert(++steps < 100);
    }
    assert.equal(s.result.success, true); assert.equal(s.cuts, 24); assert.equal(s.mistakes, 0);
  }
  assert(losses > 0); assert.equal(losses + wins, 48);
});
