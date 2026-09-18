import test from 'node:test';
import assert from 'node:assert/strict';
import { crewDeepSea as deep, crewPlanetNine as planet, crewDeck, crewTrickWinner, type CrewCard, type CrewState } from '../src/games/crew.ts';
import type { Action, GameAdapter } from '../src/types.ts';

const card = (id: string) => crewDeck().find(card => card.id === id)!;
const options = (scenarioId: string, seed = 'test', playerCount = 4) => ({ scenarioId, seed, playerCount });
function start(adapter: GameAdapter<CrewState>, state: CrewState): CrewState {
  while (state.phase === 'task-selection') state = adapter.step(state, state.currentPlayer, { type: 'select_task', taskId: state.tasks.find(task => task.owner === null)!.id });
  for (const id of state.players) state = adapter.step(state, id, { type: 'distress_vote', direction: 'none' });
  return state;
}
function fixture(kind: 'deep' | 'planet', hands: string[][], scenario?: string): CrewState {
  const adapter = kind === 'deep' ? deep : planet;
  const s = start(adapter, adapter.setup(options(scenario ?? (kind === 'deep' ? 'official-promo-1' : 'official-mission-1'))));
  s.hands = Object.fromEntries(s.players.map((id, index) => [id, hands[index].map(card)]));
  s.captain = 'p1'; s.currentPlayer = 'p1'; s.tasks = kind === 'planet' ? [{ id: 'task-1', card: card('pink-9'), owner: 'p1', order: null, completed: false }] : [];
  return s;
}
function play(adapter: GameAdapter<CrewState>, state: CrewState, ids: string[]): CrewState {
  for (const id of ids) state = adapter.step(state, state.currentPlayer, { type: 'play', cardId: id });
  return state;
}

test('exact 40-card deck, deterministic setup, validated official scope and 3-player excess card', () => {
  const cards = crewDeck();
  assert.equal(cards.length, 40); assert.equal(new Set(cards.map(card => card.id)).size, 40);
  for (const count of [3, 4, 5]) {
    const s = deep.setup(options('official-promo-1', 'stable', count));
    assert.deepEqual(s, deep.setup(options('official-promo-1', 'stable', count)));
    assert.equal(Object.values(s.hands).flat().length, 40);
    assert.equal(s.totalTricks, Math.floor(40 / count));
    if (count === 3) assert.deepEqual(Object.values(s.hands).map(hand => hand.length), [14, 13, 13]);
    assert(s.hands[s.captain].some(card => card.id === 'trump-1'));
    assert(s.hands[s.captain].filter(card => card.suit === 'trump').length < 4);
  }
  assert.throws(() => deep.setup(options('official-mission-1')));
  assert.throws(() => planet.setup(options('official-mission-4')));
  assert.throws(() => deep.setup(options('official-promo-1', 'test', 2)));
  assert.throws(() => deep.setup({ ...options('official-promo-1'), config: { hand: [] } }));
});

test('Promo all-trump captain distributions are automatically redealt without counting as failed attempts', () => {
  let found = false;
  for (let i = 0; i < 600; i++) {
    const s = deep.setup(options('official-promo-1', `redeal-${i}`, 3));
    if (s.redeals > 0) { found = true; assert(s.hands[s.captain].filter(card => card.suit === 'trump').length < 4); break; }
  }
  assert(found, 'A seeded redeal was exercised.');
});

test('Planet tasks are drawn independently, commander must take the first, no Deep Sea pass rule', () => {
  let s = planet.setup(options('official-mission-3'));
  assert(s.hands[s.captain].some(card => card.id === 'trump-4'));
  assert.deepEqual(s.tasks.map(task => task.order), [1, 2]);
  assert.throws(() => planet.step(s, s.captain, { type: 'pass' }));
  assert.throws(() => planet.step(s, s.captain, { type: 'communicate', cardId: s.hands[s.captain][0].id, relation: 'only' }));
  const original = structuredClone(s);
  s = planet.step(s, s.captain, { type: 'select_task', taskId: 'task-2' });
  assert.deepEqual(original.tasks.map(task => task.owner), [null, null]);
  assert.equal(s.tasks[1].owner, s.captain);
  assert.notEqual(s.currentPlayer, s.captain);
});

test('follow suit applies to ordinary colors and trumps, no obligation to win', () => {
  let s = fixture('deep', [['blue-3'], ['blue-2', 'blue-8', 'trump-4'], ['blue-1'], ['yellow-9']]);
  s = deep.step(s, 'p1', { type: 'play', cardId: 'blue-3' });
  const before = structuredClone(s);
  assert.throws(() => deep.step(s, 'p2', { type: 'play', cardId: 'trump-4' }));
  assert.deepEqual(s, before);
  s = play(deep, s, ['blue-2', 'blue-1', 'yellow-9']);
  assert.equal(s.lastTrick!.winner, 'p1');
  assert.equal(s.currentPlayer, 'p1');
  s = fixture('deep', [['trump-1'], ['trump-2', 'blue-8'], ['trump-4'], ['trump-3']]);
  s = deep.step(s, 'p1', { type: 'play', cardId: 'trump-1' });
  assert.throws(() => deep.step(s, 'p2', { type: 'play', cardId: 'blue-8' }));
  s = play(deep, s, ['trump-2', 'trump-4', 'trump-3']);
  assert.equal(s.lastTrick!.winner, 'p3');
});

test('trump outranks any led color, off-suit high cards cannot win', () => {
  const trick = ['blue-9', 'yellow-9', 'trump-1', 'pink-9'].map((id, index) => ({ playerId: `p${index + 1}`, card: card(id) }));
  assert.equal(crewTrickWinner(trick), 'p3');
  assert.equal(crewTrickWinner(trick.filter(play => play.card.suit !== 'trump')), 'p1');
});

test('signals are once per attempt, truthful, non-trump, any player before a trick; communicated card stays playable', () => {
  let s = fixture('deep', [['blue-6'], ['blue-1', 'blue-3', 'blue-5', 'trump-4', 'yellow-1'], ['blue-2'], ['blue-4']]);
  assert.throws(() => deep.step(s, 'p2', { type: 'communicate', cardId: 'blue-3', relation: 'highest' }));
  assert.throws(() => deep.step(s, 'p2', { type: 'communicate', cardId: 'trump-4', relation: 'only' }));
  s = deep.step(s, 'p2', { type: 'communicate', cardId: 'blue-5', relation: 'highest' });
  assert(s.hands.p2.some(card => card.id === 'blue-5'));
  assert.throws(() => deep.step(s, 'p2', { type: 'communicate', cardId: 'yellow-1', relation: 'only' }));
  s = deep.step(s, 'p1', { type: 'play', cardId: 'blue-6' });
  assert.throws(() => deep.step(s, 'p3', { type: 'communicate', cardId: 'blue-2', relation: 'only' }));
  s = play(deep, s, ['blue-5', 'blue-2', 'blue-4']);
  assert.equal(s.communication.p2.card, null);
  assert.equal(s.communication.p2.used, true);
});

test('distress requires agreement, forbids trump and moves private commitments atomically', () => {
  let s = deep.setup(options('official-promo-1'));
  for (const id of s.players) s = deep.step(s, id, { type: 'distress_vote', direction: 'left' });
  assert.equal(s.phase, 'distress-exchange');
  const chosen = Object.fromEntries(s.players.map(id => [id, s.hands[id].find(card => card.suit !== 'trump')!]));
  const previous = structuredClone(s.hands);
  const trumpOwner = s.players.find(id => s.hands[id].some(card => card.suit === 'trump'))!;
  assert.throws(() => deep.step(s, trumpOwner, { type: 'distress_pass', cardId: s.hands[trumpOwner].find(card => card.suit === 'trump')!.id }));
  const outsiderBefore = deep.observe(s, 'p2');
  const outsiderActionsBefore = deep.legalActions(s, 'p2');
  s = deep.step(s, 'p1', { type: 'distress_pass', cardId: chosen.p1.id });
  assert.deepEqual(deep.observe(s, 'p2'), outsiderBefore);
  assert.deepEqual(deep.legalActions(s, 'p2'), outsiderActionsBefore);
  assert.deepEqual(s.hands, previous);
  assert.throws(() => deep.step(s, 'p1', { type: 'distress_pass', cardId: chosen.p1.id }));
  for (const id of ['p2', 'p3', 'p4']) s = deep.step(s, id, { type: 'distress_pass', cardId: chosen[id].id });
  assert.equal(s.phase, 'play'); assert.equal(s.distress.used, true);
  for (let i = 0; i < 4; i++) {
    const owner = s.players[i]; const recipient = s.players[(i + 1) % 4];
    assert(!s.hands[owner].some(card => card.id === chosen[owner].id));
    assert(s.hands[recipient].some(card => card.id === chosen[owner].id));
  }
  assert.equal(new Set(Object.values(s.hands).flat().map(card => card.id)).size, 40);
});

test('Planet wrong owner and wrong order lose; fulfilled final objective ends immediately', () => {
  let s = fixture('planet', [['pink-9'], ['pink-1'], ['pink-2'], ['pink-3']]);
  s.tasks[0].card = card('pink-1');
  s = play(planet, s, ['pink-9', 'pink-1', 'pink-2', 'pink-3']);
  assert.equal(s.result!.success, true); assert.equal(s.tricksCompleted, 1);
  assert.deepEqual(planet.activePlayers(s), []);
  assert.throws(() => planet.step(s, 'p1', { type: 'play', cardId: 'blue-1' }));
  s = fixture('planet', [['pink-9'], ['pink-1'], ['pink-2'], ['pink-3']]);
  s.tasks[0].owner = 'p2';
  s = play(planet, s, ['pink-9', 'pink-1', 'pink-2', 'pink-3']);
  assert.equal(s.result!.success, false);
  s = fixture('planet', [['pink-9'], ['pink-1'], ['pink-2'], ['pink-3']], 'official-mission-3');
  s.tasks = [{ id: 'task-1', card: card('blue-1'), owner: 'p2', order: 1, completed: false }, { id: 'task-2', card: card('pink-1'), owner: 'p1', order: 2, completed: false }];
  s = play(planet, s, ['pink-9', 'pink-1', 'pink-2', 'pink-3']);
  assert.equal(s.result!.success, false); assert.match(s.result!.reason, /earlier/);
});

test('Deep Sea exact target cannot succeed early; forbidden captured values and excess tricks fail', () => {
  let s = fixture('deep', [['blue-6'], ['blue-1'], ['blue-2'], ['blue-3']]);
  s.tricksWon.p1 = 1;
  s = play(deep, s, ['blue-6', 'blue-1', 'blue-2', 'blue-3']);
  assert.equal(s.tricksWon.p1, 2); assert.equal(s.result, null);
  s = fixture('deep', [['blue-6'], ['blue-1'], ['blue-2'], ['blue-3']]); s.tricksWon.p1 = 2;
  s = play(deep, s, ['blue-6', 'blue-1', 'blue-2', 'blue-3']);
  assert.equal(s.result!.success, false); assert.match(s.result!.reason, /exceeded/);
  s = fixture('deep', [['trump-1'], ['blue-7'], ['blue-2'], ['blue-3']]);
  s = play(deep, s, ['trump-1', 'blue-7', 'blue-2', 'blue-3']);
  assert.equal(s.result!.success, false); assert.match(s.result!.reason, /7, 8 or 9/);
  s = fixture('deep', [['blue-6'], ['blue-1'], ['blue-2'], ['blue-3']]); s.tricksWon.p1 = 1; s.tricksCompleted = s.totalTricks - 1;
  s = play(deep, s, ['blue-6', 'blue-1', 'blue-2', 'blue-3']);
  assert.equal(s.result!.success, true);
});

test('observations and possible actor list do not disclose undealt secrets or hidden suit composition', () => {
  const s = start(deep, deep.setup(options('official-promo-1')));
  const obs = deep.observe(s, 'p1');
  assert(!('hands' in obs)); assert(!('seed' in obs)); assert(!('redeals' in obs));
  const changed = structuredClone(s);
  [changed.hands.p2, changed.hands.p3] = [changed.hands.p3, changed.hands.p2];
  assert.deepEqual(deep.observe(changed, 'p1'), obs);
  assert.deepEqual(deep.activePlayers(changed), deep.activePlayers(s));
  obs.hand.pop(); assert.notEqual(obs.hand.length, s.hands.p1.length);
});

test('3-player last trick stops with one unplayed card; no phantom fourteenth trick', () => {
  let s = start(deep, deep.setup(options('official-promo-1', 'three', 3)));
  s.hands = { p1: [card('blue-5'), card('pink-8')], p2: [card('blue-1')], p3: [card('blue-2')] };
  s.captain = 'p1'; s.currentPlayer = 'p1'; s.tricksCompleted = 12; s.tricksWon.p1 = 1;
  s = play(deep, s, ['blue-5', 'blue-1', 'blue-2']);
  assert.equal(s.result!.success, true); assert.equal(s.tricksCompleted, 13);
  assert.equal(s.hands.p1.length, 1); assert.equal(s.hands.p1[0].id, 'pink-8');
});

test('all legal-action examples execute; complete seeded games terminate for every official scenario and supported player count', () => {
  for (const adapter of [deep, planet]) for (const scenario of adapter.metadata.scenarios) for (const count of [3, 4, 5]) for (let seed = 0; seed < 12; seed++) {
    let s = adapter.setup(options(scenario.id, `rollout-${seed}`, count));
    let steps = 0;
    while (!s.result) {
      assert(steps++ < 120, 'attempt must terminate');
      const actor = s.phase === 'distress-decision' ? s.players.find(id => s.distress.votes[id] === null)! : adapter.activePlayers(s)[0];
      const choices = adapter.legalActions(s, actor).flatMap(item => item.examples ?? []);
      assert(choices.length > 0);
      for (const action of choices) {
        const snapshot = JSON.stringify(s);
        adapter.step(s, actor, action);
        assert.equal(JSON.stringify(s), snapshot, 'step must not mutate input');
      }
      const action: Action = choices.find(action => action.type === 'distress_vote' && action.direction === 'none') ?? choices.find(action => action.type === 'play') ?? choices[0];
      s = adapter.step(s, actor, action);
    }
    assert.equal(s.phase, 'ended');
  }
});
