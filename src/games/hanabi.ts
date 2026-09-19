import type { GameAdapter, Action, Outcome } from '../types.ts';
import { check, clone, makeRng, shuffle, players, nextPlayer, integer, actionKeys, legal, exactKeys } from '../common.ts';

const colors = ['white', 'red', 'blue', 'yellow', 'green'];
interface Card { id: string; color: string; value: number }
interface Slot { card: Card; colors: string[]; values: number[] }
export interface HanabiState {
  players: string[]; current: string; deck: Card[]; hands: Record<string, Slot[]>;
  fireworks: Record<string, number>; discard: Card[]; hints: number; errors: number;
  finalTurns: number | null; done: boolean; lastEvent: unknown;
}
function member(s: HanabiState, p: string) { check(s.players.includes(p), 'Unknown player.'); }
function points(s: HanabiState) { return Object.values(s.fireworks).reduce((a, b) => a + b, 0); }
function slot(card: Card): Slot { return { card, colors: [...colors], values: [1, 2, 3, 4, 5] }; }
export const hanabi: GameAdapter<HanabiState> = {
  metadata: {
    id: 'hanabi', name: 'Hanabi — Cocktail Games 2019, five colors', players: [2, 3, 4, 5],
    sources: [{ title: 'Cocktail Games 2019 official rules', url: 'https://www.cocktailgames.com/wp-content/uploads/2016/03/Hanabi_regles_0519_BD.pdf', kind: 'official-rulebook', verifiedAt: '2026-09-16' }],
    scenarios: [{ id: 'base', name: 'Official five-color random deal', provenance: 'official-random-setup', description: '50 cards; empty hints permitted by this French edition.' }],
    rulesSummary: ['See everyone else’s cards, never your own.', 'One hint, play, or discard per turn. Empty hints are permitted in the selected edition.', 'Only the current player may act; communication uses hints, with no chat or hand reordering.', 'Discard only below eight hints. Three errors end the game; complete all five fireworks for 25 points.', 'After the last draw every player including its drawer has one more turn.'],
    implementation: { fidelity: 'official-core', implemented: ['2019 five-color base game', 'empty hints', 'positive and negative hint tracking', 'final round'], omitted: ['expansions', 'Bouquet final expert variant', 'physical hand reordering as a memory aid; digital slots stay fixed until a card leaves the hand'], verifier: 'exact', notes: ['p1 replaces the nonstrategic most-colorful-clothing starting-player convention.', 'success means a perfect 25; lower non-explosive scores are official graded results, not an arbitrary loss threshold. reason distinguishes scored from explosion.', 'Explosion score is zero by benchmark convention; the official rules specify immediate defeat but no numeric explosion score. details.boardScore preserves the diagnostic firework height.', 'No arbitrary chat or public reordering; strict communication mode. Player-established conventions remain possible through legal hints.'] }
  },
  setup(o) {
    check([2, 3, 4, 5].includes(o.playerCount) && o.scenarioId === 'base', 'Unsupported setup.'); exactKeys(o.config ?? {}, []);
    const rng = makeRng(o.seed); const ids = players(o.playerCount);
    const deck = shuffle(colors.flatMap(color => [1, 1, 1, 2, 2, 3, 3, 4, 4, 5].map(value => ({ color, value }))), rng).map((c, i) => ({ ...c, id: `c${i}` }));
    const hands = Object.fromEntries(ids.map(p => [p, [] as Slot[]]));
    for (let i = 0; i < (ids.length < 4 ? 5 : 4); i++) for (const p of ids) hands[p].push(slot(deck.shift()!));
    return { players: ids, current: ids[0], deck, hands, fireworks: Object.fromEntries(colors.map(c => [c, 0])), discard: [], hints: 8, errors: 0, finalTurns: null, done: false, lastEvent: null };
  },
  observe(s, p) {
    member(s, p); return clone({ players: s.players, current: s.current, deckCount: s.deck.length, hints: s.hints, errors: s.errors, fireworks: s.fireworks, discard: s.discard, finalTurns: s.finalTurns, done: s.done, lastEvent: s.lastEvent,
      hands: Object.fromEntries(s.players.map(q => [q, s.hands[q].map((x, index) => ({ index, id: x.card.id, possibleColors: x.colors, possibleValues: x.values, ...(q === p ? {} : { color: x.card.color, value: x.card.value }) }))])) });
  },
  activePlayers(s) { return s.done ? [] : [s.current]; },
  decisionWindow(s) { return {key:s.current,players:[s.current],mode:'all'}; },
  legalActions(s, p) {
    member(s, p); if (s.done || s.current !== p) return [];
    const out: ReturnType<typeof legal>[] = [];
    const cardIndices = s.hands[p].map((_, i) => i);
    if (cardIndices.length) out.push(legal('play', 'Play any unknown hand slot; incorrect plays cost one error.', { index: { enum: cardIndices } }, undefined, cardIndices.map(index => ({ type: 'play', index }))));
    if (s.hints < 8 && cardIndices.length) out.push(legal('discard', 'Discard one slot and restore one hint.', { index: { enum: cardIndices } }, undefined, cardIndices.map(index => ({ type: 'discard', index }))));
    if (s.hints > 0) {
      const targets = s.players.filter(x => x !== p);
      const examples: Action[] = targets.flatMap(target => [...colors.map(value => ({ type: 'hint', target, kind: 'color', value })), ...[1, 2, 3, 4, 5].map(value => ({ type: 'hint', target, kind: 'value', value }))]);
      const hint = legal('hint', 'Give complete color or rank information; empty hints are legal.', { target: { enum: targets }, kind: { enum: ['color', 'value'] }, value: { anyOf: [{ enum: colors }, { enum: [1, 2, 3, 4, 5] }] } }, undefined, examples);
      hint.schema.oneOf = [{ properties: { kind: { const: 'color' }, value: { enum: colors } } }, { properties: { kind: { const: 'value' }, value: { enum: [1, 2, 3, 4, 5] } } }]; out.push(hint);
    } return out;
  },
  step(state, p, a) {
    member(state, p); check(!state.done, 'Game ended.'); const s = clone(state);
    check(s.current === p, 'Not your turn.'); const finalBefore = s.finalTurns;
    if (a.type === 'hint') {
      actionKeys(a, 'hint', ['target', 'kind', 'value']); check(s.hints > 0 && typeof a.target === 'string' && a.target !== p && s.players.includes(a.target), 'Invalid hint target or no hints.');
      check(a.kind === 'color' ? colors.includes(a.value as string) : a.kind === 'value' && integer(a.value, 1, 5), 'Invalid hint.');
      const touched: number[] = [];
      s.hands[a.target].forEach((x, i) => {
        const match = x.card[a.kind as 'color' | 'value'] === a.value; if (match) touched.push(i);
        if (a.kind === 'color') x.colors = x.colors.filter(v => match ? v === a.value : v !== a.value);
        else x.values = x.values.filter(v => match ? v === a.value : v !== a.value);
      }); s.hints--; s.lastEvent = { type: 'hint', player: p, target: a.target, kind: a.kind, value: a.value, touched };
    } else {
      check(a.type === 'play' || a.type === 'discard', 'Unknown action.'); actionKeys(a, a.type, ['index']); check(integer(a.index, 0, s.hands[p].length - 1), 'Invalid hand slot.');
      if (a.type === 'discard') check(s.hints < 8, 'Cannot discard with all hints available.');
      const c = s.hands[p].splice(a.index, 1)[0].card; let played = false;
      if (a.type === 'discard') { s.discard.push(c); s.hints++; }
      else if (c.value === s.fireworks[c.color] + 1) { s.fireworks[c.color]++; played = true; if (c.value === 5) s.hints = Math.min(8, s.hints + 1); }
      else { s.errors++; s.discard.push(c); }
      s.lastEvent = { type: a.type, player: p, index: a.index, card: c, played };
      if (s.errors < 3 && points(s) < 25 && s.deck.length) { s.hands[p].push(slot(s.deck.shift()!)); if (!s.deck.length) s.finalTurns = s.players.length; }
    }
    if (finalBefore !== null) s.finalTurns = finalBefore - 1;
    s.done = s.errors >= 3 || points(s) === 25 || s.finalTurns === 0;
    s.current = nextPlayer(s.players, p); return s;
  },
  outcome(s): Outcome | null {
    if (!s.done) return null;
    const boardScore = points(s), exploded = s.errors >= 3, perfect = !exploded && boardScore === 25;
    return { kind: exploded ? 'loss' : perfect ? 'win' : 'score-only', success: perfect, score: exploded ? 0 : boardScore, maxScore: 25,
      reason: exploded ? 'explosion' : perfect ? 'perfect' : 'scored',
      details: { errors: s.errors, boardScore, ruleset: 'cocktail-2019-five-colors', explosionScorePolicy: 'benchmark-zero-on-defeat' } };
  }
};
