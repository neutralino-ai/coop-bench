import type { Action, GameAdapter, LegalAction, Outcome } from '../types.ts';
import { actionKeys, check, clone, exactKeys, integer, legal, makeRng, nextPlayer, players, randomInt, shuffle, textValue } from '../common.ts';

interface Wire { id: string; value: number; cut: boolean; info: boolean }
interface Stand { id: string; owner: string; wires: Wire[] }
interface Pending { actor: string; target: string; value: number; wireIds: string[] }
export interface BombState {
  players: string[]; captain: string; current: string;
  phase: 'initial-info' | 'cut' | 'detector-response' | 'self-cut' | 'ended';
  stands: Stand[]; initialInfo: string[]; detectorUsed: Record<string, boolean>;
  mistakes: number; mistakeLimit: number; cuts: number; pending: Pending | null;
  chat: { playerId: string; text: string }[]; lastEvent: Record<string, unknown> | null; result: Outcome | null;
}
function wires(s: BombState, player?: string): Wire[] { return s.stands.filter(stand => !player || stand.owner === player).flatMap(stand => stand.wires); }
function uncut(s: BombState, player?: string): Wire[] { return wires(s, player).filter(wire => !wire.cut); }
function member(s: BombState, player: string) { check(s.players.includes(player), 'Unknown player.', 'UNKNOWN_PLAYER'); }
function lookup(s: BombState, id: unknown): { stand: Stand; wire: Wire } | null {
  for (const stand of s.stands) { const wire = stand.wires.find(wire => wire.id === id); if (wire) return { stand, wire }; }
  return null;
}
function end(s: BombState, success: boolean, reason: string) { s.phase = 'ended'; s.result = { success, score: Number(success), maxScore: 1, reason, details: { wiresCut: s.cuts, mistakes: s.mistakes } }; }
function advance(s: BombState) {
  s.pending = null;
  if (s.cuts === 24) { end(s, true, 'all-wires-cut'); return; }
  s.phase = 'cut';
  do { s.current = nextPlayer(s.players, s.current); } while (!uncut(s, s.current).length);
}
function revealInfo(s: BombState, wire: Wire): boolean {
  // FAQ: tokens on already-cut wires may be reused. If both copies are occupied,
  // announce the value once without adding a permanent token to that wire.
  const used = wires(s).filter(item => !item.cut && item.info && item.value === wire.value).length;
  if (wire.info) return true;
  if (used < 2) { wire.info = true; return true; }
  return false;
}
function cutWire(s: BombState, wire: Wire) { wire.cut = true; wire.info = false; s.cuts++; }
function failGuess(s: BombState, responder: string, wire: Wire) {
  const guessedValue = s.pending!.value;
  s.mistakes++;
  if (s.mistakes >= s.mistakeLimit) { s.lastEvent = { type: 'explosion', playerId: s.current, guessedValue, responder, wireId: wire.id, mistakes: s.mistakes }; s.pending = null; end(s, false, 'detonator-reached-skull'); return; }
  const hasInfoToken = revealInfo(s, wire);
  s.lastEvent = { type: 'failed-cut', actor: s.current, guessedValue, responder, wireId: wire.id, actualValue: wire.value, hasInfoToken, mistakes: s.mistakes };
  advance(s);
}
function ownCutChoices(s: BombState): Wire[] { return uncut(s, s.current).filter(wire => wire.value === s.pending!.value); }
function responderChoices(s: BombState): Wire[] {
  const candidates = s.pending!.wireIds.map(id => lookup(s, id)!.wire);
  const matching = candidates.filter(wire => wire.value === s.pending!.value);
  return matching.length ? matching : candidates;
}
function actions(s: BombState, player: string): LegalAction[] {
  member(s, player); if (s.result) return [];
  const out: LegalAction[] = [];
  const byIds = (type: string, description: string, candidates: Wire[]) => legal(type, description, { wireId: { enum: candidates.map(wire => wire.id) } }, undefined, candidates.map(wire => ({ type, wireId: wire.id })));
  if (s.phase === 'initial-info' && s.current === player) out.push(byIds('place_info', 'Point to one of your blue wires and give its value with an Info token.', uncut(s, player)));
  if (s.phase === 'self-cut' && s.current === player) out.push(byIds('finish_cut', 'Choose which matching wire in your own hand to cut.', ownCutChoices(s)));
  if (s.phase === 'detector-response' && s.pending!.target === player) out.push(byIds('detector_response', 'Choose one matching candidate to cut, or one candidate to disclose if neither matches. Do not disclose how many match.', responderChoices(s)));
  if (s.phase === 'cut' && s.current === player) {
    const values = [...new Set(uncut(s, player).map(wire => wire.value))];
    const targets = s.stands.filter(stand => stand.owner !== player).flatMap(stand => stand.wires.filter(wire => !wire.cut));
    const examples: Action[] = targets.flatMap(wire => values.map(value => ({ type: 'dual_cut', wireId: wire.id, value })));
    if (examples.length) out.push(legal('dual_cut', 'Guess one teammate wire using a value you hold. A deliberately incorrect guess remains legal.', { wireId: { enum: targets.map(wire => wire.id) }, value: { enum: values } }, undefined, examples));
    const solo = values.filter(value => {
      const ownCount = uncut(s, player).filter(wire => wire.value === value).length;
      const publicCutCount = wires(s).filter(wire => wire.cut && wire.value === value).length;
      return [2, 4].includes(ownCount) && ownCount + publicCutCount === 4;
    });
    if (solo.length) out.push(legal('solo_cut', 'Cut all 2 or 4 remaining wires of one value, all of which must be in your hand.', { value: { enum: solo } }, undefined, solo.map(value => ({ type: 'solo_cut', value }))));
    if (!s.detectorUsed[player]) {
      const detector: Action[] = [];
      for (const stand of s.stands.filter(stand => stand.owner !== player)) {
        const candidates = stand.wires.filter(wire => !wire.cut);
        for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) for (const value of values) detector.push({ type: 'double_detector', wireIds: [candidates[i].id, candidates[j].id], value });
      }
      if (detector.length) out.push(legal('double_detector', 'Use your once-per-mission detector: two uncut wires on one teammate stand, not necessarily adjacent.', { wireIds: { type: 'array', items: { enum: targets.map(wire => wire.id) }, minItems: 2, maxItems: 2, uniqueItems: true }, value: { enum: values } }, undefined, detector));
    }
  }
  out.push(legal('chat', 'Only general tactics, equipment and rules. Never discuss wire values, previous-turn information, guesses or private hypotheses.', { text: { type: 'string', minLength: 1, maxLength: 500 } }, undefined, [{ type: 'chat', text: 'Remember your personal detector is available.' }]));
  return out;
}

export const bombBusters: GameAdapter<BombState> = {
  metadata: {
    id: 'bomb-busters', name: 'Bomb Busters — Mission 1: Training Day 1', players: [2, 3, 4, 5],
    sources: [
      { title: 'Publisher English rules, v1.0 (2024)', url: 'https://www.cocktailgames.com/wp-content/uploads/2023/10/BombBusters_rules_EN.pdf', kind: 'official-rulebook', verifiedAt: '2026-09-16' },
      { title: 'Publisher official FAQ: deliberate errors, detector and token shortages', url: 'https://www.cocktailgames.com/nos-jeux/bomb-busters-faq/', kind: 'publisher', verifiedAt: '2026-09-16' },
      { title: 'Photograph of actual Japanese Mission 1 reverse, GIGAZINE publisher-supplied review copy; not a publisher-hosted download', url: 'https://i.gzn.jp/img/2025/07/20/bomb-busters/27.jpg', kind: 'official-mission', verifiedAt: '2026-09-16' },
      { title: 'Photograph of actual Mission 1 setup card; matches setup pictured on official English rulebook page 2', url: 'https://i.gzn.jp/img/2025/07/20/bomb-busters/25.jpg', kind: 'official-mission', verifiedAt: '2026-09-16' },
    ],
    scenarios: [{ id: 'official-mission-1', name: 'Mission 1 — Training Day 1', provenance: 'official-mission', sourceUrl: 'https://i.gzn.jp/img/2025/07/20/bomb-busters/27.jpg', description: '24 blue wires: 1–6 four times each. No common Equipment cards; personal Double Detectors remain available.' }],
    rulesSummary: ['Cut identical blue wires in pairs across players, or all remaining 2/4 wires alone.', 'Each stand is separately dealt and sorted. Two players each use two stands; with three players only the captain has two.', 'Each player gives one initial clue. Each has one personal Double Detector, which targets two wires on the same opposing stand.', 'A mismatch advances the dial and discloses the targeted value; the skull is reached on the player-count-th mistake.', 'The actor chooses their own matching wire only after success; failed attempts do not reveal the position of their intended wire.'],
    implementation: { fidelity: 'official-scenario', implemented: ['Mission 1 complete 24-wire set', '2–5 players and separate stands', 'initial info placement', 'dual and solo cutting', 'once-per-player Double Detector and responder choice', 'two Info tokens per value with official shortage fallback', 'skip empty players', 'exact win/loss'], omitted: ['Missions 2–66', 'Promos 67–72', 'red and yellow wires', 'common Equipment card deck'], verifier: 'objective-only', notes: ['Only Mission 1 is admitted. It explicitly excludes common Equipment cards; no mandatory component was omitted from this scenario.', 'Mission reverse verified from an actual-card review photograph, not inferred from generic rules.', 'Free-text chat legality requires transcript audit; terminal result verification is exact.', 'Captain is selected by the private seeded RNG. Uneven deals allocate the extra wire to earlier listed stands, within the rulebook instruction to deal as evenly as possible.', 'Cut wires retain their public positions. Token shortages emit one public announcement without fabricating an extra permanent token.'] },
  },
  setup(o) {
    check([2, 3, 4, 5].includes(o.playerCount) && o.scenarioId === 'official-mission-1', 'Unsupported Bomb Busters scenario.', 'INVALID_SETUP'); exactKeys(o.config ?? {}, []);
    const rng = makeRng(o.seed), ids = players(o.playerCount), captain = ids[randomInt(rng, ids.length)];
    const stands: Stand[] = ids.flatMap(owner => Array.from({ length: ids.length === 2 || (ids.length === 3 && owner === captain) ? 2 : 1 }, (_, i) => ({ id: `${owner}-stand-${i + 1}`, owner, wires: [] })));
    const values = shuffle(Array.from({ length: 24 }, (_, i) => 1 + Math.floor(i / 4)), rng);
    values.forEach((value, i) => stands[i % stands.length].wires.push({ id: '', value, cut: false, info: false }));
    stands.forEach(stand => { stand.wires.sort((a, b) => a.value - b.value); stand.wires.forEach((wire, i) => { wire.id = `${stand.id}-slot-${i + 1}`; }); });
    return { players: ids, captain, current: captain, phase: 'initial-info', stands, initialInfo: [], detectorUsed: Object.fromEntries(ids.map(id => [id, false])), mistakes: 0, mistakeLimit: ids.length, cuts: 0, pending: null, chat: [], lastEvent: null, result: null };
  },
  observe(s, p) {
    member(s, p);
    return clone({ gameId: 'bomb-busters', scenarioId: 'official-mission-1', players: s.players, captain: s.captain, current: s.current, phase: s.phase,
      stands: s.stands.map(stand => ({ id: stand.id, owner: stand.owner, wires: stand.wires.map((wire, index) => ({ id: wire.id, index, cut: wire.cut, hasInfoToken: wire.info, ...(stand.owner === p || wire.cut || wire.info ? { value: wire.value } : {}) })) })),
      detectorUsed: s.detectorUsed, initialInfo: s.initialInfo, mistakes: s.mistakes, mistakeLimit: s.mistakeLimit, wiresCut: s.cuts,
      validation: Array.from({ length: 6 }, (_, i) => i + 1).filter(value => wires(s).filter(wire => wire.cut && wire.value === value).length === 4),
      infoTokensAvailable: Object.fromEntries(Array.from({ length: 6 }, (_, i) => i + 1).map(value => [value, 2 - wires(s).filter(wire => !wire.cut && wire.info && wire.value === value).length])),
      pending: s.pending, chat: s.chat, lastEvent: s.lastEvent,
      outcome: s.result ? { success: s.result.success, score: s.result.score, reason: s.result.reason } : null,
    });
  },
  activePlayers(s) { if (s.result) return []; const actor = s.phase === 'detector-response' ? s.pending!.target : s.current; return [actor, ...s.players.filter(id => id !== actor)]; },
  legalActions: actions,
  step(state, p, a) {
    member(state, p); check(!state.result, 'Mission ended.'); const s = clone(state);
    if (a.type === 'chat') { actionKeys(a, 'chat', ['text']); check(textValue(a.text, 500), 'Invalid message.'); s.chat.push({ playerId: p, text: a.text }); return s; }
    if (a.type === 'place_info') {
      actionKeys(a, 'place_info', ['wireId']); check(s.phase === 'initial-info' && s.current === p, 'Not your initial clue turn.'); const target = lookup(s, a.wireId);
      check(target && target.stand.owner === p, 'Choose your own wire.'); const hasInfoToken = revealInfo(s, target.wire);
      s.lastEvent = { type: 'initial-info', playerId: p, wireId: target.wire.id, value: target.wire.value, hasInfoToken }; s.initialInfo.push(p);
      if (s.initialInfo.length === s.players.length) { s.phase = 'cut'; s.current = s.captain; } else s.current = nextPlayer(s.players, p);
    } else if (a.type === 'dual_cut' || a.type === 'double_detector') {
      const detector = a.type === 'double_detector'; actionKeys(a, a.type, detector ? ['wireIds', 'value'] : ['wireId', 'value']);
      check(s.phase === 'cut' && s.current === p, 'Not your cutting turn.'); check(integer(a.value, 1, 6) && uncut(s, p).some(wire => wire.value === a.value), 'You must hold an uncut wire of the announced value.');
      const ids = detector ? a.wireIds : [a.wireId]; check(Array.isArray(ids) && ids.length === (detector ? 2 : 1) && new Set(ids).size === ids.length, 'Choose distinct target wires.');
      const targets = ids.map(id => lookup(s, id)); check(targets.every(target => target && target.stand.owner !== p && !target.wire.cut), 'Target uncut wires of a teammate.');
      check(targets.every(target => target!.stand.id === targets[0]!.stand.id), 'Both detector targets must be on the same stand.');
      s.pending = { actor: p, target: targets[0]!.stand.owner, value: a.value, wireIds: ids as string[] };
      if (detector) { check(!s.detectorUsed[p], 'Your Double Detector was already used.'); s.detectorUsed[p] = true; s.phase = 'detector-response'; s.lastEvent = { type: 'double-detector', actor: p, target: s.pending.target, value: a.value, wireIds: ids }; }
      else {
        const target = targets[0]!;
        if (target.wire.value !== a.value) failGuess(s, target.stand.owner, target.wire);
        else { cutWire(s, target.wire); s.phase = 'self-cut'; s.lastEvent = { type: 'target-cut', actor: p, target: target.stand.owner, wireId: target.wire.id, value: a.value }; }
      }
    } else if (a.type === 'detector_response') {
      actionKeys(a, 'detector_response', ['wireId']); check(s.phase === 'detector-response' && s.pending!.target === p, 'Not your detector response.');
      const target = responderChoices(s).find(wire => wire.id === a.wireId); check(target, 'Select a matching wire if present, otherwise either target to disclose.');
      if (target.value !== s.pending!.value) failGuess(s, p, target);
      else { cutWire(s, target); s.phase = 'self-cut'; s.lastEvent = { type: 'target-cut', actor: s.current, target: p, wireId: target.id, value: target.value }; }
    } else if (a.type === 'finish_cut') {
      actionKeys(a, 'finish_cut', ['wireId']); check(s.phase === 'self-cut' && s.current === p, 'Not your matching cut.'); const target = ownCutChoices(s).find(wire => wire.id === a.wireId); check(target, 'Choose a matching uncut wire from your hand.');
      cutWire(s, target); s.lastEvent = { type: 'pair-completed', actor: p, wireId: target.id, value: target.value }; advance(s);
    } else if (a.type === 'solo_cut') {
      actionKeys(a, 'solo_cut', ['value']); check(s.phase === 'cut' && s.current === p, 'Not your cutting turn.'); check(integer(a.value, 1, 6), 'Unknown wire value.');
      const own = uncut(s, p).filter(wire => wire.value === a.value), remaining = uncut(s).filter(wire => wire.value === a.value);
      check([2, 4].includes(own.length) && own.length === remaining.length, 'Solo cut requires all remaining 2 or 4 wires of that value in your hand.'); own.forEach(wire => cutWire(s, wire));
      s.lastEvent = { type: 'solo-cut', playerId: p, wireIds: own.map(wire => wire.id), value: a.value }; advance(s);
    } else check(false, 'Unknown Bomb Busters action.');
    return s;
  },
  outcome: s => s.result ? clone(s.result) : null,
};
