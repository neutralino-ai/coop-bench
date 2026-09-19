import type { GameAdapter } from '../types.ts';
import { check, clone, makeRng, shuffle, players, actionKeys, integer, legal, exactKeys, textValue } from '../common.ts';
import type { RngState } from '../common.ts';
export interface PokerCard { suit: string; value: number }
export function comparePoker(a: number[], b: number[]) { for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0); return 0; }
function five(cards: PokerCard[]): number[] {
  const values = cards.map(c => c.value).sort((a, b) => b - a);
  const groups = [...new Set(values)].map(v => [values.filter(x => x === v).length, v]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const flush = cards.every(c => c.suit === cards[0].suit);
  const distinct = [...new Set(values)]; const straight = distinct.length === 5 ? (distinct[0] - distinct[4] === 4 ? distinct[0] : distinct.join() === '14,5,4,3,2' ? 5 : 0) : 0;
  if (straight && flush) return [8, straight];
  if (groups[0][0] === 4) return [7, groups[0][1], groups[1][1]];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, groups[0][1], groups[1][1]];
  if (flush) return [5, ...values]; if (straight) return [4, straight];
  if (groups[0][0] === 3) return [3, groups[0][1], ...groups.slice(1).map(x => x[1])];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, groups[0][1], groups[1][1], groups[2][1]];
  if (groups[0][0] === 2) return [1, groups[0][1], ...groups.slice(1).map(x => x[1])]; return [0, ...values];
}
export function bestPokerHand(cards: PokerCard[]): number[] {
  check(cards.length >= 5 && cards.length <= 7, 'Poker evaluator expects 5–7 cards.'); let best: number[] = [];
  for (let a = 0; a < cards.length - 4; a++) for (let b = a + 1; b < cards.length - 3; b++) for (let c = b + 1; c < cards.length - 2; c++) for (let d = c + 1; d < cards.length - 1; d++) for (let e = d + 1; e < cards.length; e++) {
    const h = five([cards[a], cards[b], cards[c], cards[d], cards[e]]); if (!best.length || comparePoker(h, best) > 0) best = h;
  } return best;
}
export interface GangState { players: string[]; rng: RngState; hands: Record<string, PokerCard[]>; deck: PokerCard[]; community: PokerCard[]; round: number; heist: number; chips: Record<string, number | null>[]; vaults: number; alarms: number; done: boolean; lastShowdown: unknown; lastEvent: unknown; chat: unknown[] }
function deal(s: GangState) {
  s.deck = shuffle(['clubs', 'diamonds', 'hearts', 'spades'].flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ suit, value: i + 2 }))), s.rng);
  s.hands = Object.fromEntries(s.players.map(p => [p, [] as PokerCard[]]));
  for (let i = 0; i < 2; i++) for (const p of s.players) s.hands[p].push(s.deck.shift()!);
  s.community = []; s.round = 1; s.chips = Array.from({ length: 4 }, () => Object.fromEntries(s.players.map(p => [p, null])));
}
function member(s: GangState, p: string) { check(s.players.includes(p), 'Unknown player.'); }
export const theGang: GameAdapter<GangState> = {
  metadata: { id: 'the-gang', name: 'The Gang — official 2024 basic game', players: [3, 4, 5, 6],
    sources: [{ title: 'Kosmos 683887 official rulebook 051624', url: 'https://www.thamesandkosmos.com/manuals/full/683887_TheGang_Manual-Web_051624.pdf', kind: 'official-rulebook', verifiedAt: '2026-09-16' }],
    scenarios: [{ id: 'base', name: 'Basic game', provenance: 'official-random-setup', description: 'Full three-to-five-heist game with four rounds per heist.' }],
    rulesSummary: ['All players may act freely; no fixed turn order.', 'Take a chip from the center or another player, or release your chip. Never give a chip to another player.', 'As soon as everyone holds a current-round chip, proceed automatically.', 'Compare the best five of seven cards in red-chip order. Equal hands are allowed. Three vaults win; three alarms lose.'],
    implementation: { fidelity: 'official-core', implemented: ['52-card basic game', 'free chip taking and release', 'automatic rounds', 'best-five showdown including ties', 'all heists'], omitted: ['advanced specialist/challenge cards', 'Deluxe/7–10 player expansion'], verifier: 'objective-only', notes: ['HTTP arrival order serializes simultaneous physical chip actions without enforcing turns.', 'No extra confirmation phase: official page 6 ends the round as soon as every player has a chip.', 'chat allows public-information discussion. Whether text indirectly leaks private-hand knowledge needs an external audit; the exact outcome verifier does not certify speech compliance.'] } },
  setup(o) { check([3, 4, 5, 6].includes(o.playerCount) && o.scenarioId === 'base', 'Unsupported setup.'); exactKeys(o.config ?? {}, []); const s: GangState = { players: players(o.playerCount), rng: makeRng(o.seed), hands: {}, deck: [], community: [], round: 1, heist: 1, chips: [], vaults: 0, alarms: 0, done: false, lastShowdown: null, lastEvent: null, chat: [] }; deal(s); return s; },
  observe(s, p) { member(s, p); return clone({ players: s.players, hand: s.hands[p], community: s.community, round: s.round, heist: s.heist, chips: s.chips, vaults: s.vaults, alarms: s.alarms, done: s.done, lastShowdown: s.lastShowdown, lastEvent: s.lastEvent, chat: s.chat }); },
  activePlayers(s) { return s.done ? [] : [...s.players]; },
  decisionWindow(s) { return {key:`${s.heist}:${s.round}`,players:s.players.filter(p=>s.chips[s.round-1]?.[p] == null),mode:'all'}; },
  legalActions(s, p) { member(s, p); if (s.done) return []; const held = s.chips[s.round - 1][p]; const ranks = s.players.map((_, i) => i + 1); return [
    ...(held === null ? [legal('claim', 'Take a current-round chip, possibly from another player.', { rank: { enum: ranks } }, undefined, ranks.map(rank => ({ type: 'claim', rank })))] : [legal('release', 'Return your current chip to the center.', {}, undefined, [{ type: 'release' }])]),
    legal('chat', 'Discuss public information only; never reveal or hint private-hand knowledge.', { text: { type: 'string', minLength: 1, maxLength: 500 } }, undefined, [{ type: 'chat', text: 'The public board is paired.' }]) ]; },
  step(state, p, a) {
    member(state, p); check(!state.done, 'Game ended.'); const s = clone(state); const current = s.chips[s.round - 1];
    if (a.type === 'chat') { actionKeys(a, 'chat', ['text']); check(textValue(a.text, 500), 'Invalid text.'); s.chat.push({ player: p, text: a.text, heist: s.heist, round: s.round }); return s; }
    if (a.type === 'claim') { actionKeys(a, 'claim', ['rank']); check(current[p] === null && integer(a.rank, 1, s.players.length), 'Release your chip first or choose a valid rank.'); const prior = s.players.find(q => current[q] === a.rank); if (prior) current[prior] = null; current[p] = a.rank; s.lastEvent = { type: 'claim', player: p, rank: a.rank, prior: prior ?? null }; }
    else { actionKeys(a, 'release'); check(current[p] !== null, 'No chip to release.'); s.lastEvent = { type: 'release', player: p, rank: current[p] }; current[p] = null; }
    if (s.players.every(q => current[q] !== null)) {
      if (s.round < 4) { s.community.push(...s.deck.splice(0, s.round === 1 ? 3 : 1)); s.round++; }
      else {
        const order = [...s.players].sort((a, b) => current[a]! - current[b]!); const hands = order.map(q => ({ player: q, cards: s.hands[q], best: bestPokerHand([...s.hands[q], ...s.community]), rank: current[q] }));
        const success = hands.every((h, i) => i === 0 || comparePoker(hands[i - 1].best, h.best) <= 0);
        s.lastShowdown = { heist: s.heist, community: [...s.community], hands, success }; if (success) s.vaults++; else s.alarms++;
        s.done = s.vaults === 3 || s.alarms === 3; if (!s.done) { s.heist++; deal(s); }
      }
    } return s;
  },
  outcome(s) { return s.done ? { success: s.vaults === 3, score: s.vaults, maxScore: 3, reason: s.vaults === 3 ? 'three-vaults' : 'three-alarms' } : null; }
};
