import { createHmac } from 'node:crypto';
import { GameEngine } from '../vendor/take-time/engine.ts';
import { check, clone, exactKeys, legal } from '../common.ts';
import type { Action, GameAdapter, SetupOptions } from '../types.ts';

interface State { seed: string; options: SetupOptions; actions: { playerId: string; action: Action }[] }
// Reuse the audited 1-1 engine. Its randomly generated card UUIDs are remapped to
// a private seeded opaque ID, so save/replay is deterministic without changing it.
function cardId(state: State, card: { color: string; value: number }): string {
  return createHmac('sha256', state.seed).update(`take-time/id/v1:${card.color}:${card.value}`).digest('hex').slice(0, 32);
}
function engine(state: State): GameEngine {
  const game = new GameEngine({ playerCount: state.options.playerCount as 2 | 3 | 4,
    bonusTokens: state.options.config?.bonusTokens ?? 0 }, { seed: state.seed });
  for (const { playerId, action } of state.actions) {
    const a = clone(action);
    if (a.type === 'place') {
      const card = game.observe(playerId).hand?.find(c => cardId(state, c) === a.cardId);
      check(card, 'Card not in your hand.'); a.cardId = card.id;
    }
    game.act(playerId, a);
    if (game.getPublicState().phase === 'resolution') game.resolve();
  }
  return game;
}
function stable(state: State, value: any): any {
  if (Array.isArray(value)) return value.map(x => stable(state, x));
  if (value !== null && typeof value === 'object') {
    const mapped = Object.fromEntries(Object.entries(value).map(([k,v]) => [k, stable(state,v)]));
    if (typeof value.id === 'string' && typeof value.value === 'number' && typeof value.color === 'string') mapped.id = cardId(state,value);
    return mapped;
  }
  return value;
}
export const takeTime: GameAdapter<State> = {
  metadata: {
    id: 'take-time', name: 'Take Time / 时序谜局', players: [2,3,4],
    sources: [{ title: 'Official Chinese rules', url: 'https://cdn.svc.asmodee.net/production-libellud/uploads/2025/09/TT_RULES_CNS_WEB.pdf', kind: 'official-rulebook', verifiedAt: '2026-09-17' }],
    scenarios: [{ id: 'official-clock-1-1', name: 'Chapter 1, Clock 1 (1-1)', provenance: 'official-mission', description: 'All six sums nondecreasing; first position exactly one solar card, sixth exactly three cards.' }],
    rulesSummary: new GameEngine({}, {seed:'rules-only'}).getRules().instructions,
    implementation: { fidelity: 'official-scenario', implemented: ['Clock 1-1, 2–4 players', 'Discussion until personally looking', 'Optional face-up plays; all-face-down legal', 'Two-player reserve draw', 'Automatic reveal and judgment'], omitted: ['Clocks 1-2 through 10-4', 'Automatic campaign progression'], verifier: 'exact', notes: ['Reuses the vendored take-time engine; source lineage is recorded in docs/vendor-lineage.json. New attempts with bonusTokens 0–3 are configured by the trusted coordinator; no in-game player reset.'] }
  },
  setup(options) {
    check(options.scenarioId === 'official-clock-1-1', 'Unsupported clock.', 'INVALID_CONFIG');
    exactKeys(options.config ?? {}, ['bonusTokens']);
    const state = { seed: options.seed, options: clone(options), actions: [] };
    engine(state); return state;
  },
  observe(state, playerId) {
    const observation = stable(state, engine(state).observe(playerId));
    // Derived solely from already-public backs. These are CURRENT counts; do
    // not reconstruct an earlier frame from cards revealed later in the game.
    const count = (backs: string[]) => ({ solar: backs.filter(color => color === 'solar').length,
      lunar: backs.filter(color => color === 'lunar').length });
    observation.cardColorCounts = Object.fromEntries(Object.entries(observation.cardBacks)
      .map(([id, backs]) => [id, { hand: count((backs as any).hand), reserve: count((backs as any).reserve) }]));
    return observation;
  },
  activePlayers(state) { return engine(state).getPublicState().activePlayerIds; },
  legalActions(state, playerId) {
    const obs = this.observe(state,playerId);
    if (obs.legalActions.includes('look_hand')) return [
      legal('speak','Discuss freely before you look. All players’ solar/lunar back counts are public; no official turn order or sentence budget.',{text:{type:'string',minLength:1,maxLength:2000}}),
      legal('look_hand','Inspect your cards and become silent.',{},[],[{type:'look_hand'}])
    ];
    if (!obs.legalActions.includes('place')) return [];
    const ids = obs.hand.map((c:any)=>c.id);
    const examples:Action[] = [];
    for (const id of ids) for(let position=1;position<=6;position++) {
      examples.push({type:'place',cardId:id,position,faceUp:false});
      if(obs.faceUpRemaining > 0) examples.push({type:'place',cardId:id,position,faceUp:true});
    }
    return [legal('place','Place one card; face up is optional.',{cardId:{type:'string',enum:ids},position:{type:'integer',minimum:1,maximum:6},faceUp:{type:'boolean'}},['cardId','position'],examples)];
  },
  step(state,playerId,action) {
    const next = clone(state); next.actions.push({playerId,action:clone(action)});
    engine(next); return next;
  },
  outcome(state) {
    const result = engine(state).getPublicState().result;
    return result ? { kind: result.won?'win':'loss', success:result.won, score:result.won?1:0, maxScore:1,
      reason:result.won?'All clock conditions satisfied.':result.violations.join(' '), details:stable(state,result) } : null;
  }
};
