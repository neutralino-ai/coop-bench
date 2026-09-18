import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skyTeam as game, type SkyTeamState } from '../src/games/sky-team.ts';
import type { Action } from '../src/types.ts';

const setup = (seed = 'sky-team-tests') => game.setup({ playerCount: 2, seed, scenarioId: 'yul' });
function started(): SkyTeamState { return game.step(game.step(setup(), 'p1', { type: 'ready' }), 'p2', { type: 'ready' }); }
function fixture(values1: number[], values2: number[]): SkyTeamState {
  const s = started(); s.rerollTokens = 0;
  s.dice.p1 = values1.map((value, i) => ({ id: `p1-d${i + 1}`, value }));
  s.dice.p2 = values2.map((value, i) => ({ id: `p2-d${i + 1}`, value }));
  return s;
}
function put(s: SkyTeamState, id: string, space: string, value: number, coffee = 0): SkyTeamState {
  const die = s.dice[id].find(d => Math.abs(d.value - value) <= coffee);
  assert.ok(die, `Fixture lacks a usable ${value} die for ${id}`);
  return game.step(s, id, { type: 'place', dieId: die.id, space, value, coffee });
}

test('official YUL component transcription and deterministic private roll', () => {
  const s = setup(); assert.deepEqual(s.traffic, [0, 0, 1, 2, 1, 3, 2]);
  assert.equal(s.rerollTokens, 1); assert.deepEqual(game.observe(s, 'p1').myDice, []);
  assert.deepEqual(started(), started());
  assert.equal(started().dice.p1.length, 4);
  assert.throws(() => game.setup({ playerCount: 3, seed: 'x', scenarioId: 'yul' }));
  assert.throws(() => game.setup({ playerCount: 2, seed: 'x', scenarioId: 'invented' }));
});

test('discussion happens before any roll; silence and turn permissions are enforced', () => {
  const s = setup(); const before = structuredClone(s);
  const discussed = game.step(s, 'p2', { type: 'message', text: 'We should clear the approach.' });
  assert.deepEqual(s, before); assert.equal(discussed.messages.length, 1);
  assert.deepEqual(discussed.dice, { p1: [], p2: [] });
  const rolled = started(), copy = structuredClone(rolled);
  assert.throws(() => game.step(rolled, 'p1', { type: 'message', text: 'My dice are...' }));
  assert.throws(() => put(rolled, 'p2', 'axis-p2', rolled.dice.p2[0].value));
  assert.deepEqual(rolled, copy);
});

test('player observation and legal actions are independent of opponent hidden values', () => {
  const s = started(), other = structuredClone(s);
  other.dice.p2.forEach(d => { d.value = d.value % 6 + 1; });
  assert.deepEqual(game.observe(s, 'p1'), game.observe(other, 'p1'));
  assert.deepEqual(game.legalActions(s, 'p1'), game.legalActions(other, 'p1'));
  const observation = game.observe(s, 'p1'); observation.myDice[0].value = 999;
  assert.notEqual(s.dice.p1[0].value, 999);
  assert.equal('rng' in observation, false); assert.equal('dice' in observation, false);
});

test('coffee is shared, bounded and cannot wrap a die', () => {
  let s = fixture([4, 5, 2, 2], [3, 5, 2, 2]);
  s = put(s, 'p1', 'coffee-1', 4); assert.equal(s.coffee, 1);
  s = put(s, 'p2', 'flap-1', 2, 1); assert.equal(s.coffee, 0); assert.equal(s.flaps[0], true);
  s.coffee = 3;
  s = put(s, 'p1', 'coffee-2', 5); assert.equal(s.coffee, 3);
  assert.throws(() => game.step(s, 'p2', { type: 'place', dieId: s.dice.p2[0].id, space: 'coffee-3', value: 0, coffee: 1 }));
});

test('gear can repeat without moving aerodynamic marker again; flap deployment is ordered', () => {
  let s = fixture([2, 2, 3, 4], [4, 2, 3, 4]);
  s.gear[0] = true; s = put(s, 'p1', 'gear-1', 2);
  assert.equal(game.observe(s, 'p1').aerodynamicMarkers.blue, 5.5);
  assert.throws(() => put(s, 'p2', 'flap-3', 4));
  s = put(s, 'p2', 'flap-1', 2); assert.equal(s.flaps[0], true);
});

test('axis is cumulative and a third mark causes an immediate loss', () => {
  let s = fixture([2, 2, 2, 2], [3, 2, 2, 2]); s.axis = 2;
  s = put(s, 'p1', 'axis-p1', 2); s = put(s, 'p2', 'axis-p2', 3);
  assert.equal(s.axis, 3); assert.equal(game.outcome(s)?.reason, 'axis_spin');
});

test('entering a traffic-filled space is allowed, but departure or crossing collides', () => {
  let s = fixture([5, 2, 2, 2], [5, 2, 2, 2]);
  s = put(s, 'p1', 'engine-p1', 5); s = put(s, 'p2', 'engine-p2', 5);
  assert.equal(s.position, 2); assert.equal(game.outcome(s), null);
  let crossing = fixture([5, 2, 2, 2], [5, 2, 2, 2]); crossing.position = 1;
  crossing = put(crossing, 'p1', 'engine-p1', 5); crossing = put(crossing, 'p2', 'engine-p2', 5);
  assert.equal(crossing.position, 2); assert.equal(game.outcome(crossing)?.reason, 'traffic_collision');
});

test('radio range counts current space as one and out-of-track radio is a legal no-op', () => {
  let s = fixture([1, 2, 3, 4], [6, 2, 3, 4]); s.position = 2;
  s = put(s, 'p1', 'radio-p1', 1); assert.equal(s.traffic[2], 0);
  const traffic = [...s.traffic]; s = put(s, 'p2', 'radio-p2-1', 6);
  assert.deepEqual(s.traffic, traffic);
});

test('airport may be reached early but moving past it loses', () => {
  let s = fixture([4, 2, 2, 2], [3, 2, 2, 2]); s.position = 6; s.traffic.fill(0);
  s = put(s, 'p1', 'engine-p1', 4); s = put(s, 'p2', 'engine-p2', 3);
  assert.equal(game.outcome(s)?.reason, 'airport_overshoot');
});

test('shared reroll works out of turn, selections remain private, and resolution ignores arrival order', () => {
  let s = started(); s = game.step(s, 'p2', { type: 'request_reroll' });
  assert.equal(s.rerollTokens, 0); assert.equal(s.turn, 'p1');
  const a1: Action = { type: 'reroll_selection', dieIds: ['p1-d1', 'p1-d3'] };
  const a2: Action = { type: 'reroll_selection', dieIds: ['p2-d2'] };
  const before = game.observe(s, 'p2');
  const partial = game.step(s, 'p1', a1);
  assert.deepEqual(game.observe(partial, 'p2'), before);
  const forward = game.step(partial, 'p2', a2);
  const reverse = game.step(game.step(s, 'p2', a2), 'p1', a1);
  assert.deepEqual(forward, reverse); assert.equal(forward.phase, 'placement'); assert.equal(forward.turn, 'p1');
  assert.throws(() => game.step(s, 'p1', { type: 'reroll_selection', dieIds: ['p2-d1'] }));
});

test('all eight dice must be placed and each mandatory action is checked at round end', () => {
  let s = fixture([1, 2, 3, 4], [1, 2, 3, 4]);
  const actions: [string, string, number][] = [
    ['p1', 'gear-1', 1], ['p2', 'flap-1', 1], ['p1', 'coffee-1', 2], ['p2', 'flap-2', 2],
    ['p1', 'gear-2', 3], ['p2', 'coffee-2', 3], ['p1', 'radio-p1', 4], ['p2', 'coffee-3', 4]
  ];
  for (const [player, space, value] of actions) s = put(s, player, space, value);
  assert.equal(game.outcome(s)?.reason, 'mandatory_axis_or_engine_missing');
});

function lastRound(): SkyTeamState {
  const s = fixture([1, 1, 4, 2], [1, 2, 3, 4]);
  s.round = 7; s.altitude = 0; s.position = 6; s.traffic.fill(0);
  s.gear.fill(true); s.flaps.fill(true); s.brakes[0] = true;
  return s;
}
function land(brakeBeforeEngines: boolean): SkyTeamState {
  let s = lastRound();
  s = put(s, 'p1', 'axis-p1', 1); s = put(s, 'p2', 'axis-p2', 1);
  if (brakeBeforeEngines) {
    s = put(s, 'p1', 'brake-4', 4); s = put(s, 'p2', 'radio-p2-1', 3);
    s = put(s, 'p1', 'engine-p1', 1); s = put(s, 'p2', 'engine-p2', 2);
    s = put(s, 'p1', 'coffee-1', 2); s = put(s, 'p2', 'coffee-2', 4);
  } else {
    s = put(s, 'p1', 'engine-p1', 1); s = put(s, 'p2', 'engine-p2', 2);
    s = put(s, 'p1', 'brake-4', 4); s = put(s, 'p2', 'radio-p2-1', 3);
    s = put(s, 'p1', 'coffee-1', 2); s = put(s, 'p2', 'coffee-2', 4);
  }
  return s;
}

test('landing checks brakes when the second engine is placed, not after later brake deployment', () => {
  assert.equal(game.outcome(land(true))?.success, true);
  assert.equal(game.outcome(land(false))?.success, false);
});

test('brake 2 means marker 2.5: two one-valued engines can land', () => {
  let s = lastRound(); s.dice.p2[1].value = 1;
  s = put(s, 'p1', 'engine-p1', 1); s = put(s, 'p2', 'engine-p2', 1);
  assert.equal(s.landingEngineCheck, true);
});

test('round transition alternates starter, keeps coffee, and collects second reroll at 2000', () => {
  let s = fixture([2, 2, 3, 4], [2, 2, 3, 4]); s.altitude = 3000; s.round = 4; s.coffee = 1;
  const actions: [string, string, number][] = [
    ['p1', 'axis-p1', 2], ['p2', 'axis-p2', 2], ['p1', 'engine-p1', 2], ['p2', 'engine-p2', 2],
    ['p1', 'gear-2', 3], ['p2', 'radio-p2-1', 3], ['p1', 'radio-p1', 4], ['p2', 'coffee-1', 4]
  ];
  for (const [id, space, value] of actions) s = put(s, id, space, value);
  assert.equal(s.phase, 'discussion'); assert.equal(s.altitude, 2000); assert.equal(s.round, 5);
  assert.equal(s.turn, 'p1'); assert.equal(s.rerollTokens, 1); assert.equal(s.coffee, 2);
  assert.deepEqual(s.placed, {});
});

test('failure to reach airport before round seven loses before a new roll', () => {
  let s = fixture([2, 2, 3, 4], [2, 2, 3, 4]); s.altitude = 1000; s.round = 6;
  const actions: [string, string, number][] = [
    ['p1', 'axis-p1', 2], ['p2', 'axis-p2', 2], ['p1', 'engine-p1', 2], ['p2', 'engine-p2', 2],
    ['p1', 'gear-2', 3], ['p2', 'radio-p2-1', 3], ['p1', 'radio-p1', 4], ['p2', 'coffee-1', 4]
  ];
  for (const [id, space, value] of actions) s = put(s, id, space, value);
  assert.equal(game.outcome(s)?.reason, 'ground_reached_before_airport');
});

test('every offered example executes unchanged-input, and 40 seeded legal rollouts terminate', () => {
  for (let run = 0; run < 40; run++) {
    let s = setup(`rollout-${run}`), steps = 0;
    while (!game.outcome(s) && steps++ < 100) {
      const ids = game.activePlayers(s);
      const id = s.phase === 'placement' ? s.turn : ids.find(x => !s.ready[x]) ?? ids[0];
      const actions = game.legalActions(s, id);
      const menu = actions.find(a => a.type === 'ready') ?? actions.find(a => a.type === 'place') ?? actions[0];
      const examples = menu.examples!;
      if (run < 3) for (const example of examples) { const before = structuredClone(s); game.step(s, id, example); assert.deepEqual(s, before); }
      s = game.step(s, id, examples[(run * 11 + steps * 7) % examples.length]);
    }
    assert.ok(game.outcome(s), `No terminal result for seed ${run}`);
    assert.deepEqual(game.activePlayers(s), []); assert.deepEqual(game.legalActions(s, 'p1'), []);
  }
});
