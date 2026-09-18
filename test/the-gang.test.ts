import test from 'node:test';
import assert from 'node:assert/strict';
import { theGang, bestPokerHand, comparePoker, type PokerCard } from '../src/games/the-gang.ts';
const setup = () => theGang.setup({ playerCount: 3, seed: 'gang-tests', scenarioId: 'base' });
const cards = (values: number[], suits = ['clubs','diamonds','hearts','spades','clubs','diamonds','hearts']): PokerCard[] => values.map((value, i) => ({ value, suit: suits[i] }));
test('Poker best five handles wheel, best full house, quads, board-only tie and kickers', () => {
  assert.deepEqual(bestPokerHand(cards([14,2,3,4,5,9,9])), [4,5]);
  assert.deepEqual(bestPokerHand(cards([14,14,14,13,13,13,2])), [6,14,13]);
  assert.deepEqual(bestPokerHand(cards([5,5,5,5,14,2,3])), [7,5,14]);
  const royal = cards([10,11,12,13,14], Array(5).fill('hearts'));
  assert.deepEqual(bestPokerHand([...royal, ...cards([2,3])]), [8,14]);
  assert.equal(comparePoker(bestPokerHand([...royal, ...cards([2,3])]), bestPokerHand([...royal, ...cards([8,9])])), 0);
  assert.ok(comparePoker(bestPokerHand(cards([2,2,14,13,9,8,3])), bestPokerHand(cards([2,2,14,12,9,8,3]))) > 0);
});
test('Gang no turn order; chip theft removes prior holder, release before retaking; auto rounds', () => {
  let s = setup(); s = theGang.step(s, 'p3', { type: 'claim', rank: 2 }); const before = structuredClone(s);
  s = theGang.step(s, 'p1', { type: 'claim', rank: 2 }); assert.equal(s.chips[0].p3, null); assert.deepEqual(before.chips[0], { p1: null, p2: null, p3: 2 });
  assert.throws(() => theGang.step(s, 'p1', { type: 'claim', rank: 1 })); s = theGang.step(s, 'p1', { type: 'release' });
  for (const [p, rank] of [['p2',3],['p3',1],['p1',2]] as const) s = theGang.step(s, p, { type: 'claim', rank });
  assert.equal(s.round, 2); assert.equal(s.community.length, 3); assert.equal(s.chips[0].p2, 3);
});
test('Gang only current own pocket and public board are projected', () => {
  const s = setup(); const v = theGang.observe(s, 'p1'); assert.ok(!('hands' in v) && !('deck' in v) && !('rng' in v)); assert.deepEqual(v.hand, s.hands.p1);
  assert.equal(new Set([...s.deck, ...Object.values(s.hands).flat()].map(x => `${x.suit}${x.value}`)).size, 52);
});
test('Gang complete correctly ranked heists wins at three; true ties also win', () => {
  let s = setup();
  while (!s.done) {
    const order = s.round === 4 ? [...s.players].sort((a,b) => comparePoker(bestPokerHand([...s.hands[a],...s.community]), bestPokerHand([...s.hands[b],...s.community]))) : [...s.players];
    for (let i = 0; i < order.length; i++) s = theGang.step(s, order[i], { type: 'claim', rank: i + 1 });
  }
  assert.equal(s.heist, 3); assert.equal(s.alarms, 0); assert.equal(theGang.outcome(s)?.success, true);
  const tie = setup(); tie.round = 4; tie.vaults = 2; tie.community = cards([10,11,12,13,14], Array(5).fill('hearts')); let t = tie;
  for (let i = 0; i < 3; i++) t = theGang.step(t, t.players[i], { type: 'claim', rank: 3 - i });
  assert.equal(theGang.outcome(t)?.success, true);
});
