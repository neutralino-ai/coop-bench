import type { GameAdapter, Action } from '../types.ts';
import { check, clone, makeRng, shuffle, players, integer, actionKeys, legal, exactKeys, textValue } from '../common.ts';
export interface TheGameState { players: string[]; current: string | null; deck: number[]; hands: Record<string, number[]>; piles: number[]; handSize: number; laidThisTurn: number; played: number; done: boolean; chat: unknown[]; lastEvent: unknown }
function canLay(value: number, top: number, pile: number) { return pile < 2 ? value > top || value === top - 10 : value < top || value === top + 10; }
function pairs(hand: number[], piles: number[]): { card: number; pile: number }[] { return hand.flatMap(card => piles.flatMap((top, pile) => canLay(card, top, pile) ? [{ card, pile }] : [])); }
function canFinishMinimum(hand: number[], piles: number[], required: number): boolean {
  if (required <= 0) return true;
  return pairs(hand, piles).some(({ card, pile }) => { const next = [...piles]; next[pile] = card; return canFinishMinimum(hand.filter(c => c !== card), next, required - 1); });
}
function minimum(s: TheGameState) { return s.deck.length ? 2 : 1; }
function member(s: TheGameState, p: string) { check(s.players.includes(p), 'Unknown player.'); }
function checkEnd(s: TheGameState) { if (s.played === 98) s.done = true; else if (s.current && !canFinishMinimum(s.hands[s.current], s.piles, minimum(s) - s.laidThisTurn)) s.done = true; }
export const theGame: GameAdapter<TheGameState> = {
  metadata: { id: 'the-game', name: 'The Game — NSV original base rules', players: [1, 2, 3, 4, 5],
    sources: [{ title: 'NSV official English rules, TheGame_GB.pdf', url: 'https://www.nsv.de/wp-content/uploads/2024/04/TheGame_GB.pdf', kind: 'official-rulebook', verifiedAt: '2026-09-16' }],
    scenarios: [{ id: 'base', name: 'Original random deal', provenance: 'official-random-setup', description: '98 number cards, two ascending and two descending piles.' }],
    rulesSummary: ['Play 2–99 to ascending piles starting at 1 or descending piles starting at 100.', 'A reverse step of exactly ten is allowed.', 'Play at least two cards per turn, or at least one once the deck is empty. Draw only after ending a turn.', 'Look at your hands before choosing the starting player; continue clockwise. Talk freely except relating concrete card numbers.', 'Beat the game by placing all 98 cards; otherwise count unplayed cards.'],
    implementation: { fidelity: 'official-core', implemented: ['all base player counts', 'starter selection', 'single-card placements', 'reverse-ten exception', 'draw and minimum transitions', 'skip empty hands', 'public discussion'], omitted: ['expert difficulty variants'], verifier: 'objective-only', notes: ['chat preserves official permitted conversation. No automatic semantic claim that messages avoid revealing exact private numbers; audit that separately.', 'choose_start records the table’s chosen starting player; social consensus is not mechanically enforced.', 'score counts played cards (98 minus the official unplayed-card measure). success means all 98 played.'] } },
  setup(o) { check([1, 2, 3, 4, 5].includes(o.playerCount) && o.scenarioId === 'base', 'Unsupported setup.'); exactKeys(o.config ?? {}, []); const ids = players(o.playerCount); const handSize = ids.length === 1 ? 8 : ids.length === 2 ? 7 : 6; const deck = shuffle(Array.from({ length: 98 }, (_, i) => i + 2), makeRng(o.seed)); const hands = Object.fromEntries(ids.map(p => [p, deck.splice(0, handSize)])); return { players: ids, current: null, deck, hands, piles: [1, 1, 100, 100], handSize, laidThisTurn: 0, played: 0, done: false, chat: [], lastEvent: null }; },
  observe(s, p) { member(s, p); return clone({ players: s.players, current: s.current, hand: s.hands[p], handCounts: Object.fromEntries(s.players.map(q => [q, s.hands[q].length])), deckCount: s.deck.length, piles: s.piles, laidThisTurn: s.laidThisTurn, minimum: minimum(s), played: s.played, done: s.done, chat: s.chat, lastEvent: s.lastEvent }); },
  activePlayers(s) { return s.done ? [] : [...s.players]; },
  decisionWindow(s) { return {key:`${s.current}:${s.played-s.laidThisTurn}`,players:s.current?[s.current]:s.players,mode:s.current?'all':'any'}; },
  legalActions(s, p) {
    member(s, p); if (s.done) return [];
    const out = [legal('chat', 'No concrete private card numbers; other discussion is permitted.', { text: { type: 'string', minLength: 1, maxLength: 500 } }, undefined, [{ type: 'chat', text: 'Please leave the first pile for me.' }])];
    if (!s.current) { out.push(legal('choose_start', 'Record the team’s chosen starter.', { player: { enum: s.players } }, undefined, s.players.map(player => ({ type: 'choose_start', player })))); return out; }
    if (s.current !== p) return out;
    const options = pairs(s.hands[p], s.piles);
    if (options.length) { const actions: Action[] = options.map(x => ({ type: 'play', ...x })); const entry = legal('play', 'Place one card, then continue or end your turn after the minimum.', { card: { enum: s.hands[p] }, pile: { enum: [0, 1, 2, 3] } }, undefined, actions); entry.schema.oneOf = options.map(x => ({ properties: { card: { const: x.card }, pile: { const: x.pile } } })); out.push(entry); }
    if (s.laidThisTurn >= minimum(s)) out.push(legal('end_turn', 'Draw back up to your hand limit; advance clockwise.', {}, undefined, [{ type: 'end_turn' }]));
    return out;
  },
  step(state, p, a) {
    member(state, p); check(!state.done, 'Game ended.'); const s = clone(state);
    if (a.type === 'chat') { actionKeys(a, 'chat', ['text']); check(textValue(a.text, 500), 'Invalid text.'); s.chat.push({ player: p, text: a.text }); return s; }
    if (a.type === 'choose_start') { actionKeys(a, 'choose_start', ['player']); check(s.current === null && typeof a.player === 'string' && s.players.includes(a.player), 'Invalid starter.'); s.current = a.player; s.lastEvent = { type: 'choose_start', player: a.player }; checkEnd(s); return s; }
    check(s.current === p, 'Not your turn.');
    if (a.type === 'play') {
      actionKeys(a, 'play', ['card', 'pile']); check(integer(a.card, 2, 99) && s.hands[p].includes(a.card) && integer(a.pile, 0, 3), 'Invalid card or pile.'); check(canLay(a.card, s.piles[a.pile], a.pile), 'Card violates the pile order.');
      s.hands[p].splice(s.hands[p].indexOf(a.card), 1); s.piles[a.pile] = a.card; s.played++; s.laidThisTurn++; s.lastEvent = { type: 'play', player: p, card: a.card, pile: a.pile };
    } else {
      actionKeys(a, 'end_turn'); check(s.laidThisTurn >= minimum(s), 'Minimum cards not played.'); s.hands[p].push(...s.deck.splice(0, s.handSize - s.hands[p].length));
      s.laidThisTurn = 0; const start = s.players.indexOf(p); let next: string | null = null;
      for (let i = 1; i <= s.players.length; i++) { const q = s.players[(start + i) % s.players.length]; if (s.hands[q].length) { next = q; break; } }
      s.current = next; s.lastEvent = { type: 'end_turn', player: p };
    } checkEnd(s); return s;
  },
  outcome(s) { return s.done ? { success: s.played === 98, score: s.played, maxScore: 98, reason: s.played === 98 ? 'all-cards-played' : 'cannot-play-minimum', details: { unplayed: 98 - s.played } } : null; }
};
