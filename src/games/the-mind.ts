import type { GameAdapter } from '../types.ts';
import { check, clone, makeRng, shuffle, players, actionKeys, integer, legal, exactKeys } from '../common.ts';
import type { RngState } from '../common.ts';
export interface MindState { players: string[]; rng: RngState; hands: Record<string, number[]>; level: number; maxLevel: number; lives: number; stars: number; phase: 'focus' | 'play' | 'ended'; ready: string[]; starVotes: string[]; played: number[]; removed: number[]; completed: number; lastEvent: unknown }
function deal(s: MindState) { const cards = shuffle(Array.from({ length: 100 }, (_, i) => i + 1), s.rng); s.hands = Object.fromEntries(s.players.map(p => [p, cards.splice(0, s.level).sort((a, b) => a - b)])); s.phase = 'focus'; s.ready = []; s.starVotes = []; s.played = []; s.removed = []; }
function focus(s: MindState) { s.phase = 'focus'; s.ready = []; s.starVotes = []; }
function progress(s: MindState) {
  if (s.lives <= 0) { s.phase = 'ended'; return; }
  if (s.players.some(p => s.hands[p].length)) return;
  s.completed = s.level;
  if ([2, 5, 8].includes(s.level)) s.stars = Math.min(3, s.stars + 1);
  if ([3, 6, 9].includes(s.level)) s.lives = Math.min(5, s.lives + 1);
  if (s.level === s.maxLevel) { s.phase = 'ended'; return; }
  s.level++; deal(s);
}
function member(s: MindState, p: string) { check(s.players.includes(p), 'Unknown player.'); }
export const theMind: GameAdapter<MindState> = {
  metadata: { id: 'the-mind', name: 'The Mind — NSV base face-up levels', players: [2, 3, 4],
    sources: [{ title: 'NSV official English rules, TheMind_GB.pdf', url: 'https://www.nsv.de/wp-content/uploads/2024/04/TheMind_GB.pdf', kind: 'official-rulebook', verifiedAt: '2026-09-16' }],
    scenarios: [{ id: 'base', name: 'Complete standard level sequence', provenance: 'official-random-setup', description: '2/3/4 players complete 12/10/8 levels with lives and throwing stars.' }],
    rulesSummary: ['There is no turn order. Anyone may play their lowest card when they choose.', 'Do not communicate card values, count seconds or use secret signals.', 'All ready resumes focus. Anyone may stop to refocus.', 'A too-high play costs one life in total; remove all lower cards and refocus.', 'Unanimous throwing-star agreement discards every player’s lowest card and refocuses.', 'Stars at levels 2,5,8; lives at 3,6,9; maxima three stars and five lives.'],
    implementation: { fidelity: 'official-core', implemented: ['free order face-up play', 'all standard levels', 'stop and unanimous focus', 'lives', 'unanimous throwing stars', 'level rewards'], omitted: ['post-victory blind challenge', 'physical gestures and facial expressions'], verifier: 'objective-only', notes: ['Rule transitions are exact; timing behavior depends on the runner. Do not schedule fixed player turns.', 'The server records actual arrival order. This adapter does not impose a seconds-per-number policy or fabricate thinking delays.', 'Request latency and polling can affect performance. This runtime is not certified equivalent to physical human timing.', 'success verifies level completion; it does not prove agents avoided mental counting or out-of-band signals.', 'A pending star vote is withdrawn on a card play or stop; this prevents stale consent being applied to a changed hand state.'] } },
  setup(o) { check([2, 3, 4].includes(o.playerCount) && o.scenarioId === 'base', 'Unsupported setup.'); exactKeys(o.config ?? {}, []); const s: MindState = { players: players(o.playerCount), rng: makeRng(o.seed), hands: {}, level: 1, maxLevel: o.playerCount === 2 ? 12 : o.playerCount === 3 ? 10 : 8, lives: o.playerCount, stars: 1, phase: 'focus', ready: [], starVotes: [], played: [], removed: [], completed: 0, lastEvent: null }; deal(s); return s; },
  observe(s, p) { member(s, p); return clone({ players: s.players, hand: s.hands[p], handCounts: Object.fromEntries(s.players.map(q => [q, s.hands[q].length])), level: s.level, maxLevel: s.maxLevel, lives: s.lives, stars: s.stars, phase: s.phase, ready: s.ready, starVotes: s.starVotes, played: s.played, removed: s.removed, completed: s.completed, lastEvent: s.lastEvent }); },
  activePlayers(s) { return s.phase === 'ended' ? [] : [...s.players]; },
  legalActions(s, p) {
    member(s, p); if (s.phase === 'ended') return [];
    const out = s.phase === 'focus' ? (s.ready.includes(p) ? [] : [legal('ready', 'Place your hand down to focus; all ready resumes play.', {}, undefined, [{ type: 'ready' }])]) : [legal('stop', 'Stop and refocus the team.', {}, undefined, [{ type: 'stop' }])];
    if (s.phase === 'play' && s.hands[p].length) out.push(legal('play', 'Play your lowest card now, without a prescribed turn.', { card: { const: s.hands[p][0] } }, undefined, [{ type: 'play', card: s.hands[p][0] }]));
    if (s.stars > 0) out.push(legal('star_vote', 'Raise or lower your hand to agree to a throwing star.', { agree: { type: 'boolean' } }, undefined, [{ type: 'star_vote', agree: true }, { type: 'star_vote', agree: false }]));
    return out;
  },
  step(state, p, a) {
    member(state, p); check(state.phase !== 'ended', 'Game ended.'); const s = clone(state);
    if (a.type === 'ready') { actionKeys(a, 'ready'); check(s.phase === 'focus' && !s.ready.includes(p), 'Not awaiting your readiness.'); s.ready.push(p); s.lastEvent = { type: 'ready', player: p }; if (s.ready.length === s.players.length) { s.phase = 'play'; s.ready = []; } return s; }
    if (a.type === 'star_vote') {
      actionKeys(a, 'star_vote', ['agree']); check(s.stars > 0 && typeof a.agree === 'boolean', 'Invalid throwing-star vote.'); s.starVotes = s.starVotes.filter(q => q !== p); if (a.agree) s.starVotes.push(p); s.lastEvent = { type: 'star_vote', player: p, agree: a.agree };
      if (s.starVotes.length === s.players.length) { const removed = s.players.flatMap(q => s.hands[q].length ? [s.hands[q].shift()!] : []); s.removed.push(...removed); s.stars--; focus(s); s.lastEvent = { type: 'throwing_star', removed }; progress(s); } return s;
    }
    check(s.phase === 'play', 'Team must focus before playing.');
    if (a.type === 'stop') { actionKeys(a, 'stop'); focus(s); s.lastEvent = { type: 'stop', player: p }; return s; }
    actionKeys(a, 'play', ['card']); check(integer(a.card, 1, 100) && s.hands[p][0] === a.card, 'Only your lowest card can be played.');
    s.hands[p].shift(); s.played.push(a.card); s.starVotes = [];
    const skipped = s.players.flatMap(q => s.hands[q].filter(v => v < (a.card as number)));
    if (skipped.length) { for (const q of s.players) s.hands[q] = s.hands[q].filter(v => v > (a.card as number)); s.removed.push(...skipped); s.lives--; focus(s); }
    s.lastEvent = { type: 'play', player: p, card: a.card, skipped, lostLife: skipped.length > 0 }; progress(s); return s;
  },
  outcome(s) { return s.phase === 'ended' ? { success: s.lives > 0 && s.completed === s.maxLevel, score: s.completed, maxScore: s.maxLevel, reason: s.lives <= 0 ? 'no-lives' : 'all-levels-completed' } : null; }
};
