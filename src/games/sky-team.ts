import type { Action, GameAdapter, LegalAction, Outcome, PlayerId } from '../types.ts';
import { actionKeys, check, clone, exactKeys, integer, legal, makeRng, randomInt, textValue } from '../common.ts';

const RULES = 'https://www.scorpionmasque.com/sites/scorpionmasque.com/files/st_rules01_en_06jun2023.pdf';
const FR_RULES = 'https://www.scorpionmasque.com/sites/scorpionmasque.com/files/st_rules01_fr_08nov2023.pdf';
const IDS = ['p1', 'p2'];
const GEAR = [[1, 2], [3, 4], [5, 6]];
const FLAPS = [[1, 2], [2, 3], [4, 5], [5, 6]];
const BRAKES = [2, 4, 6];
const ANY = [1, 2, 3, 4, 5, 6];
type Die = { id: string; value: number };
type Placement = { playerId: string; value: number; coffee: number };
type Space = { id: string; playerId: string | null; values: number[]; kind: string; index?: number };
const SPACES: Space[] = [
  ...IDS.flatMap(playerId => ['axis', 'engine'].map(kind => ({ id: `${kind}-${playerId}`, playerId, values: ANY, kind }))),
  { id: 'radio-p1', playerId: 'p1', values: ANY, kind: 'radio' },
  { id: 'radio-p2-1', playerId: 'p2', values: ANY, kind: 'radio' },
  { id: 'radio-p2-2', playerId: 'p2', values: ANY, kind: 'radio' },
  ...GEAR.map((values, index) => ({ id: `gear-${index + 1}`, playerId: 'p1', values, kind: 'gear', index })),
  ...FLAPS.map((values, index) => ({ id: `flap-${index + 1}`, playerId: 'p2', values, kind: 'flap', index })),
  ...BRAKES.map((value, index) => ({ id: `brake-${value}`, playerId: 'p1', values: [value], kind: 'brake', index })),
  ...[1, 2, 3].map(index => ({ id: `coffee-${index}`, playerId: null, values: ANY, kind: 'coffee' })),
];

export interface SkyTeamState {
  gameId: 'sky-team'; scenarioId: 'yul'; phase: 'discussion' | 'placement' | 'reroll' | 'finished';
  round: number; altitude: number; position: number; traffic: number[]; axis: number;
  gear: boolean[]; flaps: boolean[]; brakes: boolean[]; coffee: number; rerollTokens: number;
  ready: Record<string, boolean>; turn: string; dice: Record<string, Die[]>;
  placed: Record<string, Placement>; landingEngineCheck: boolean | null;
  rerollChoices: Record<string, string[] | null> | null;
  messages: { round: number; playerId: string; text: string }[];
  events: Record<string, unknown>[]; result: Outcome | null; rng: ReturnType<typeof makeRng>;
}

function validPlayer(playerId: string): void { check(IDS.includes(playerId), 'Unknown player.', 'UNKNOWN_PLAYER'); }
function fail(s: SkyTeamState, reason: string): void {
  s.phase = 'finished'; s.result = { success: false, score: 0, maxScore: 1, reason };
}
function roll(s: SkyTeamState): void {
  for (const playerId of IDS) s.dice[playerId] = [1, 2, 3, 4].map(index => ({ id: `${playerId}-d${index}`, value: randomInt(s.rng, 6) + 1 }));
  s.phase = 'placement';
  s.turn = s.round % 2 === 1 ? 'p1' : 'p2';
  s.events.push({ type: 'roll', round: s.round });
}
function allowedSpace(s: SkyTeamState, playerId: string, sp: Space, value: number): boolean {
  if (s.placed[sp.id] || (sp.playerId !== null && sp.playerId !== playerId) || !sp.values.includes(value)) return false;
  // Previously activated switches may be used again, with no further effect.
  if (sp.kind === 'flap' && sp.index! > 0 && !s.flaps[sp.index! - 1]) return false;
  if (sp.kind === 'brake' && sp.index! > 0 && !s.brakes[sp.index! - 1]) return false;
  return true;
}
function canModify(from: number, to: number, cost: number): boolean {
  // Extra pairs of +/- adjustments are also legal; dice never wrap at 1/6.
  return Math.abs(to - from) <= cost && (cost - Math.abs(to - from)) % 2 === 0;
}
function finishRound(s: SkyTeamState): void {
  if (IDS.some(id => !s.placed[`axis-${id}`] || !s.placed[`engine-${id}`])) { fail(s, 'mandatory_axis_or_engine_missing'); return; }
  if (s.altitude === 0) {
    const remaining = s.traffic.reduce((a, b) => a + b, 0);
    const success = remaining === 0 && s.gear.every(Boolean) && s.flaps.every(Boolean) && s.axis === 0 && s.landingEngineCheck === true;
    s.result = { success, score: Number(success), maxScore: 1, reason: success ? 'landed_safely' : 'landing_conditions_not_met', details: { trafficRemaining: remaining, gear: s.gear, flaps: s.flaps, axis: s.axis, engineCheckAtPlacement: s.landingEngineCheck } };
    s.phase = 'finished'; return;
  }
  s.altitude -= 1000; s.round++;
  if (s.altitude === 0 && s.position !== 6) { fail(s, 'ground_reached_before_airport'); return; }
  s.placed = {}; s.dice = { p1: [], p2: [] }; s.landingEngineCheck = null;
  s.phase = 'discussion'; s.ready = { p1: false, p2: false };
  s.turn = s.round % 2 === 1 ? 'p1' : 'p2';
  if (s.altitude === 2000) s.rerollTokens++;
  s.events.push({ type: 'round_start', round: s.round, altitude: s.altitude });
}
function place(s: SkyTeamState, playerId: string, action: Action): void {
  actionKeys(action, 'place', ['dieId', 'space', 'value', 'coffee']);
  check(s.phase === 'placement' && s.turn === playerId, 'It is not your placement turn.');
  check(typeof action.dieId === 'string' && typeof action.space === 'string', 'Specify dieId and space.');
  check(integer(action.value, 1, 6) && integer(action.coffee, 0, s.coffee), 'Invalid die value or coffee spend.');
  const die = s.dice[playerId].find(d => d.id === action.dieId);
  const sp = SPACES.find(space => space.id === action.space);
  check(die && sp, 'Unknown die or space.');
  const value = action.value as number, cost = action.coffee as number;
  check(canModify(die.value, value, cost), 'Coffee changes the die by one per token and cannot wrap.');
  check(allowedSpace(s, playerId, sp, value), 'Space is occupied or violates colour, value, or sequence constraints.');
  s.dice[playerId] = s.dice[playerId].filter(d => d.id !== die.id);
  s.coffee -= cost; s.placed[sp.id] = { playerId, value, coffee: cost };
  s.events.push({ type: 'place', round: s.round, playerId, space: sp.id, value, coffee: cost });
  if (sp.kind === 'axis' && s.placed['axis-p1'] && s.placed['axis-p2']) {
    s.axis += s.placed['axis-p2'].value - s.placed['axis-p1'].value;
    if (Math.abs(s.axis) >= 3) fail(s, 'axis_spin');
  } else if (sp.kind === 'engine' && s.placed['engine-p1'] && s.placed['engine-p2']) {
    const speed = s.placed['engine-p1'].value + s.placed['engine-p2'].value;
    if (s.altitude === 0) {
      const count = s.brakes.filter(Boolean).length;
      // The red marker sits AFTER the numeral: 2.5 / 4.5 / 6.5.
      s.landingEngineCheck = speed < [1.5, 2.5, 4.5, 6.5][count];
    } else {
      const low = 4.5 + s.gear.filter(Boolean).length, high = 8.5 + s.flaps.filter(Boolean).length;
      const distance = speed < low ? 0 : speed > high ? 2 : 1;
      for (let move = 0; move < distance; move++) {
        if (s.traffic[s.position] > 0) { fail(s, 'traffic_collision'); break; }
        if (s.position === 6) { fail(s, 'airport_overshoot'); break; }
        s.position++;
      }
    }
  } else if (sp.kind === 'radio') {
    const target = s.position + value - 1;
    if (target < s.traffic.length && s.traffic[target] > 0) s.traffic[target]--;
  } else if (sp.kind === 'gear') s.gear[sp.index!] = true;
  else if (sp.kind === 'flap') s.flaps[sp.index!] = true;
  else if (sp.kind === 'brake') s.brakes[sp.index!] = true;
  else if (sp.kind === 'coffee') s.coffee = Math.min(3, s.coffee + 1);
  if (s.phase === 'finished') return;
  s.turn = playerId === 'p1' ? 'p2' : 'p1';
  if (IDS.every(id => s.dice[id].length === 0)) finishRound(s);
}
function subsets<T>(values: T[]): T[][] { return Array.from({ length: 2 ** values.length }, (_, bits) => values.filter((_, i) => bits & (1 << i))); }

export const skyTeam: GameAdapter<SkyTeamState> = {
  metadata: {
    id: 'sky-team', name: 'Sky Team', players: [2],
    sources: [{ title: 'Landing Procedure (2023-06-06)', url: RULES, kind: 'official-rulebook', verifiedAt: '2026-09-16' }, { title: 'Procédure d’atterrissage (2023-11-08)', url: FR_RULES, kind: 'official-rulebook', verifiedAt: '2026-09-16' }],
    scenarios: [{ id: 'yul', name: 'YUL Montréal-Trudeau — base teaching flight', provenance: 'official-mission', description: 'The complete seven-round base scenario shown in the official Landing Procedure.', sourceUrl: RULES }],
    rulesSummary: [
      'Two players: p1 pilot (blue), p2 co-pilot (orange). Discuss strategy before each round, never dice values or conditional dice instructions; remain silent after rolling.',
      'Each round roll four private d6 each, then alternate placing one die. Each player must use their axis and engine spaces before the round ends.',
      'Axis changes by orange minus blue and crashes at ±3. Engines move 0/1/2 spaces immediately according to the current aerodynamic markers; departing a traffic-filled space crashes.',
      'Pilot: landing gear, brakes, one radio. Co-pilot: four ordered flaps, two radios. Either player: three concentration spaces; shared coffee adjusts values by ±1 per token.',
      'Either player can spend a shared reroll token at any placement boundary; both privately choose any remaining dice to reroll once.',
      'Seven rounds from 6000 to 0 feet. Reach the airport before starting the final round; on landing clear all traffic, deploy every gear/flap, level the axis, and satisfy the brake threshold at engine placement.'
    ],
    implementation: { fidelity: 'official-scenario', implemented: ['YUL exact setup', 'seven rounds', 'private dice', 'per-round strategy discussion', 'all base control-panel spaces', 'coffee', 'shared rerolls', 'official terminal checks'], omitted: ['other airports', 'Flight Log modules', 'Turbulence expansion'], verifier: 'objective-only', notes: ['Free-text discussion timing is enforced; the prohibition on discussing dice or arranging coded signals requires transcript review. Result verification is mechanical and does not certify semantic communication compliance.', 'Shared rerolls use simultaneous private choices; no reroll selections or opponent dice are exposed.', 'The initial scenario has traffic [0,0,1,2,1,3,2], rerolls at 6000/2000 feet, and alternating first players.', 'No rulebook artwork or component images are served by this environment.'] }
  },
  setup(options) {
    check(options.playerCount === 2, 'Sky Team requires exactly two players.', 'INVALID_SETUP');
    check(options.scenarioId === 'yul', 'Only the official YUL teaching flight is implemented.', 'INVALID_SETUP');
    exactKeys(options.config ?? {}, []);
    return { gameId: 'sky-team', scenarioId: 'yul', phase: 'discussion', round: 1, altitude: 6000, position: 0, traffic: [0, 0, 1, 2, 1, 3, 2], axis: 0, gear: [false, false, false], flaps: [false, false, false, false], brakes: [false, false, false], coffee: 0, rerollTokens: 1, ready: { p1: false, p2: false }, turn: 'p1', dice: { p1: [], p2: [] }, placed: {}, landingEngineCheck: null, rerollChoices: null, messages: [], events: [{ type: 'round_start', round: 1, altitude: 6000 }], result: null, rng: makeRng(options.seed) };
  },
  observe(s, playerId) {
    validPlayer(playerId);
    return clone({ gameId: s.gameId, scenarioId: s.scenarioId, phase: s.phase, playerId, role: playerId === 'p1' ? 'pilot' : 'co-pilot', round: s.round, altitude: s.altitude, position: s.position, airportPosition: 6, traffic: s.traffic, axis: s.axis, gear: s.gear, flaps: s.flaps, brakes: s.brakes, coffee: s.coffee, rerollTokens: s.rerollTokens, turn: s.turn, ready: s.ready, myDice: s.dice[playerId], remainingDice: Object.fromEntries(IDS.map(id => [id, s.dice[id].length])), placed: s.placed, spaces: SPACES, aerodynamicMarkers: { blue: 4.5 + s.gear.filter(Boolean).length, orange: 8.5 + s.flaps.filter(Boolean).length }, brakeMarker: [1.5, 2.5, 4.5, 6.5][s.brakes.filter(Boolean).length], myRerollSelectionSubmitted: s.rerollChoices ? s.rerollChoices[playerId] !== null : false, messages: s.messages, events: s.events, outcome: s.result ? { success: s.result.success, score: s.result.score, maxScore: 1, reason: s.result.reason } : null, communication: { canSendMessage: s.phase === 'discussion', restriction: 'Discuss strategic goals only; do not discuss dice, hypothetical values, or coded dice instructions. Silent after rolling.' } });
  },
  activePlayers(s) {
    if (s.phase === 'finished') return [];
    if (s.phase === 'discussion') return IDS.slice();
    if (s.phase === 'reroll') return IDS.filter(id => s.rerollChoices![id] === null);
    // The non-moving player may interrupt with a shared reroll.
    return s.rerollTokens > 0 ? IDS.slice() : [s.turn];
  },
  legalActions(s, playerId) {
    validPlayer(playerId);
    if (s.phase === 'finished') return [];
    if (s.phase === 'discussion') return [
      legal('message', 'Public pre-roll strategy; talking about dice is prohibited and audited separately.', { text: { type: 'string', minLength: 1, maxLength: 2000 } }, ['text'], [{ type: 'message', text: 'Let us review traffic and the distance remaining.' }]),
      ...(!s.ready[playerId] ? [legal('ready', 'Finish discussing; both ready causes the private dice roll.', {}, [], [{ type: 'ready' }])] : [])
    ];
    if (s.phase === 'reroll') return s.rerollChoices![playerId] !== null ? [] : [legal('reroll_selection', 'Privately choose remaining dice, or an empty list to keep all.', { dieIds: { type: 'array', items: { enum: s.dice[playerId].map(d => d.id) }, uniqueItems: true } }, ['dieIds'], subsets(s.dice[playerId].map(d => d.id)).map(dieIds => ({ type: 'reroll_selection', dieIds })))];
    const result: LegalAction[] = [];
    if (s.turn === playerId) {
      const examples: Action[] = [];
      for (const die of s.dice[playerId]) for (let cost = 0; cost <= s.coffee; cost++) for (const value of ANY) if (canModify(die.value, value, cost)) for (const sp of SPACES) if (allowedSpace(s, playerId, sp, value)) examples.push({ type: 'place', dieId: die.id, space: sp.id, value, coffee: cost });
      if (examples.length) result.push(legal('place', 'Place one die with optional shared coffee; legal does not mean strategically safe.', { dieId: { enum: s.dice[playerId].map(d => d.id) }, space: { enum: SPACES.map(sp => sp.id) }, value: { type: 'integer', minimum: 1, maximum: 6 }, coffee: { type: 'integer', minimum: 0, maximum: s.coffee } }, ['dieId', 'space', 'value', 'coffee'], examples));
    }
    if (s.rerollTokens > 0) result.push(legal('request_reroll', 'Spend one token to offer both players a private reroll, without consuming the placement turn.', {}, [], [{ type: 'request_reroll' }]));
    return result;
  },
  step(state, playerId, action) {
    validPlayer(playerId); check(state.phase !== 'finished', 'The flight is finished.');
    const s = clone(state);
    if (action.type === 'message') {
      actionKeys(action, 'message', ['text']); check(s.phase === 'discussion', 'Speech is forbidden after the dice roll.');
      check(textValue(action.text, 2000), 'Message must contain 1–2000 characters.');
      s.messages.push({ round: s.round, playerId, text: action.text }); s.ready[playerId] = false;
    } else if (action.type === 'ready') {
      actionKeys(action, 'ready'); check(s.phase === 'discussion' && !s.ready[playerId], 'Already ready or not discussing.');
      s.ready[playerId] = true; if (IDS.every(id => s.ready[id])) roll(s);
    } else if (action.type === 'place') place(s, playerId, action);
    else if (action.type === 'request_reroll') {
      actionKeys(action, 'request_reroll'); check(s.phase === 'placement' && s.rerollTokens > 0, 'No shared reroll is available.');
      s.rerollTokens--; s.phase = 'reroll'; s.rerollChoices = { p1: null, p2: null };
      s.events.push({ type: 'reroll_requested', round: s.round, playerId });
    } else if (action.type === 'reroll_selection') {
      actionKeys(action, 'reroll_selection', ['dieIds']);
      check(s.phase === 'reroll' && s.rerollChoices![playerId] === null, 'No pending selection for this player.');
      check(Array.isArray(action.dieIds) && action.dieIds.every(id => typeof id === 'string' && s.dice[playerId].some(d => d.id === id)) && new Set(action.dieIds).size === action.dieIds.length, 'Select distinct dice remaining behind your own screen.');
      s.rerollChoices![playerId] = action.dieIds as string[];
      if (IDS.every(id => s.rerollChoices![id] !== null)) {
        // Player and die order, not network arrival order, owns the chance stream.
        for (const id of IDS) for (const die of s.dice[id]) if (s.rerollChoices![id]!.includes(die.id)) die.value = randomInt(s.rng, 6) + 1;
        s.rerollChoices = null; s.phase = 'placement'; s.events.push({ type: 'reroll_resolved', round: s.round });
      }
    } else check(false, 'Unknown action.');
    return s;
  },
  outcome: s => s.result ? clone(s.result) : null,
};
