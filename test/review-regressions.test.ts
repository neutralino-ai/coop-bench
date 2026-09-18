import test from 'node:test';
import assert from 'node:assert/strict';
import { Authority } from '../src/authority.ts';
import { check } from '../src/common.ts';
import type { GameAdapter } from '../src/types.ts';
import { skyTeam } from '../src/games/sky-team.ts';
import { hanabi } from '../src/games/hanabi.ts';
import { theGang } from '../src/games/the-gang.ts';
import { theGame } from '../src/games/the-game.ts';
import { theMind } from '../src/games/the-mind.ts';

test('review: own observation and legal actions do not reveal counterfactual hidden cards or dice', () => {
  const sky = skyTeam.setup({ playerCount: 2, scenarioId: 'yul', seed: 'projection-review' });
  let skyPlay = skyTeam.step(sky, 'p1', { type: 'ready' });
  skyPlay = skyTeam.step(skyPlay, 'p2', { type: 'ready' });
  const skyChanged = structuredClone(skyPlay);
  skyChanged.dice.p2.forEach(die => { die.value = die.value === 6 ? 1 : die.value + 1; });
  assert.deepEqual(skyTeam.observe(skyPlay, 'p1'), skyTeam.observe(skyChanged, 'p1'));
  assert.deepEqual(skyTeam.legalActions(skyPlay, 'p1'), skyTeam.legalActions(skyChanged, 'p1'));

  const hana = hanabi.setup({ playerCount: 3, scenarioId: 'base', seed: 'projection-review' });
  const hanaChanged = structuredClone(hana);
  [hanaChanged.hands.p1[0].card.color, hanaChanged.hands.p1[0].card.value] = ['blue', 5];
  assert.deepEqual(hanabi.observe(hana, 'p1'), hanabi.observe(hanaChanged, 'p1'));
  assert.deepEqual(hanabi.legalActions(hana, 'p1'), hanabi.legalActions(hanaChanged, 'p1'));

  for (const adapter of [theGang, theGame, theMind] as GameAdapter[]) {
    const state = adapter.setup({ playerCount: 3, scenarioId: 'base', seed: 'projection-review' });
    const changed = structuredClone(state);
    [changed.hands.p2, changed.hands.p3] = [changed.hands.p3, changed.hands.p2];
    assert.deepEqual(adapter.observe(state, 'p1'), adapter.observe(changed, 'p1'), adapter.metadata.id);
    assert.deepEqual(adapter.legalActions(state, 'p1'), adapter.legalActions(changed, 'p1'), adapter.metadata.id);
  }
});

test('review: projection error rolls back state AND rejected-event hash, preserving replay', () => {
  const adapter: GameAdapter<{ value: number }> = {
    metadata: {
      id: 'projection-fault-fixture', name: 'Test fixture', players: [2], sources: [],
      scenarios: [{ id: 'fixture', name: 'Fixture', provenance: 'research-generated', description: 'Fault injection only' }], rulesSummary: [],
      implementation: { fidelity: 'research-adaptation', implemented: [], omitted: [], verifier: 'exact', notes: [] },
    },
    setup: () => ({ value: 0 }),
    observe: (state, player) => { check(!(state.value === 1 && player === 'p2'), 'Injected projection error', 'INTERNAL'); return { value: state.value }; },
    activePlayers: () => ['p1', 'p2'], legalActions: () => [], step: () => ({ value: 1 }), outcome: () => null,
  };
  const authority = new Authority(':memory:', [adapter], 'review-fixture');
  try {
    const game = authority.create(adapter.metadata.id, { playerCount: 2, scenarioId: 'fixture', seed: 'fixture' });
    const observation = authority.observe(game.episodeId, game.seats[0].token);
    const result = authority.submit(game.episodeId, game.seats[0].token, 'fault', {
      observationId: observation.observationId, decisionToken: observation.decisionToken, action: { type: 'change' },
    });
    assert.equal(result.body.accepted, false);
    assert.equal(authority.observe(game.episodeId, game.seats[0].token).view.value, 0);
    authority.truncate(game.episodeId, 'end regression fixture');
    assert.equal(authority.verifyReplay(game.episodeId).valid, true);
  } finally { authority.close(); }
});
