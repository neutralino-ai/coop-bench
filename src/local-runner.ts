import { createHash } from 'node:crypto';
import type { Action, GameAdapter, JsonObject, LegalAction, Outcome, SetupOptions } from './types.ts';

/** This in-process boundary prevents accidental omniscience; it is not a sandbox
 * for untrusted JavaScript. Run adversarial policies in isolated processes. */
export interface PolicyInput {
  gameId: string;
  scenarioId: string;
  playerId: string;
  observation: JsonObject;
  /** Changed own projections since setup or the previous policy call. */
  observationHistory: JsonObject[];
  legalActions: LegalAction[];
}
export type LocalPolicy = (input: Readonly<PolicyInput>) => Action | null | Promise<Action | null>;
export interface ScheduleInput {
  activePlayerIds: string[];
  candidates: { playerId: string; actionTypes: string[] }[];
  previousPlayerId: string | null;
}
export type LocalScheduler = (input: Readonly<ScheduleInput>) => string | null;
export interface LocalRunOptions {
  setup: SetupOptions;
  policies?: Record<string, LocalPolicy>;
  policy?: LocalPolicy;
  scheduler?: LocalScheduler;
  policyName?: string;
  /** Defaults to policy-evaluation with a supplied policy, otherwise mechanical-smoke.
   * Explicit mechanical-smoke permits partial custom policies with mechanical fallbacks. */
  purpose?: 'mechanical-smoke' | 'policy-evaluation';
  maxActions?: number;
  /** Explicit simulated clock, only for adapters exposing advanceTime. */
  clockStepMs?: number;
  maxTimeAdvances?: number;
}
type PublicOutcome = Omit<Outcome, 'details'>;
interface HashPair { beforeHash: string; afterHash: string }
export type LocalEvent = (HashPair & {
  kind: 'action'; sequence: number; playerId: string; action: Action;
  observationHash: string; observationHistoryHash: string; legalActionsHash: string;
}) | (HashPair & { kind: 'time'; sequence: number; elapsedMs: number });
export interface LocalTrainingRow {
  schemaVersion: 'coop-bench/local-transition/v2';
  purpose: 'mechanical-smoke' | 'policy-evaluation';
  /** Dataset metadata only; not a policy input. Same seed across games/groups stays together. */
  partitionFamily: string;
  gameId: string; scenarioId: string; playerId: string; decisionIndex: number;
  observation: JsonObject; observationHistory: JsonObject[]; legalActions: LegalAction[]; action: Action;
  /** Next decision for the SAME player, or that player's final observation. */
  nextObservation: JsonObject; nextObservationHistory: JsonObject[]; nextLegalActions: LegalAction[];
  reward: number | null; terminated: boolean; truncated: boolean;
  outcome: PublicOutcome | null;
}
export interface LocalAudit {
  schemaVersion: 'coop-bench/local-audit/v2';
  privileged: true;
  partitionFamily: string;
  gameId: string; setup: SetupOptions;
  purpose: 'mechanical-smoke' | 'policy-evaluation'; policyName: string;
  maxActions: number; clockStepMs: number; maxTimeAdvances: number;
  initialStateHash: string; events: LocalEvent[]; finalStateHash: string;
  terminated: boolean; truncated: boolean; truncationReason: string | null;
  outcome: Outcome | null;
}
export interface LocalRunResult {
  partitionFamily: string;
  gameId: string; scenarioId: string; playerCount: number;
  actions: number; timeAdvances: number; simulatedElapsedMs: number;
  terminated: boolean; truncated: boolean; truncationReason: string | null;
  outcome: PublicOutcome | null; audit: LocalAudit; trainingRows: LocalTrainingRow[];
}
function clone<T>(value: T): T { return structuredClone(value); }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); for (const item of Object.values(value)) freeze(item);
  } return value;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as JsonObject)[key])]));
  return value;
}
/** Audit-only digest. Never supplied to a policy or a training input. */
export function localDigest(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function safeOutcome(outcome: Outcome | null): PublicOutcome | null {
  if (!outcome) return null;
  const { details: _, ...publicFields } = outcome; return clone(publicFields);
}
function budget(value: number | undefined, fallback: number, name: string): number {
  const n = value ?? fallback; if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be a nonnegative safe integer.`); return n;
}
/** Simulated broadcast of legal own views. No sequence numbers, timestamps or
 * empty checkpoints: an invisible state change creates no distinguishable row. */
function observationFeed(game: GameAdapter, playerCount: number) {
  const ids = Array.from({ length: playerCount }, (_, i) => `p${i + 1}`);
  const previous = new Map<string, string>();
  const pending = new Map<string, JsonObject[]>(ids.map(id => [id, []]));
  return {
    capture(state: unknown): void {
      for (const id of ids) {
        const view = game.observe(state, id), fingerprint = localDigest(view);
        if (previous.get(id) !== fingerprint) { pending.get(id)!.push(clone(view)); previous.set(id, fingerprint); }
      }
    },
    peek(id: string): JsonObject[] { return clone(pending.get(id) ?? []); },
    take(id: string): JsonObject[] { const history = clone(pending.get(id) ?? []); pending.set(id, []); return history; },
  };
}
const ignored = new Set(['chat', 'message', 'speak', 'reorder', 'stop']);
function priority(type: string): number {
  if (ignored.has(type)) return Infinity;
  if (['choose_start', 'look_hand', 'ready', 'select_task', 'distress_vote', 'distress_pass', 'reroll_selection'].includes(type)) return 10;
  if (type === 'end_turn') return 15;
  if (['play', 'place', 'claim', 'cut'].includes(type)) return 20;
  if (['move', 'explore', 'use_hourglass', 'hourglass'].includes(type)) return 25;
  if (['hint', 'discard', 'communicate'].includes(type)) return 40;
  if (['request_reroll', 'star_vote', 'release'].includes(type)) return 70;
  return 50;
}

/** Mechanical progress policy, not an intelligent or timing-legal strategy. */
export const mechanicalPolicy: LocalPolicy = input => {
  const entries = input.legalActions.filter(item => item.examples?.length && Number.isFinite(priority(item.type))).sort((a, b) => priority(a.type) - priority(b.type));
  for (const entry of entries) {
    const examples = entry.examples!;
    if (input.gameId === 'the-gang' && entry.type === 'claim') {
      const round = input.observation.round;
      const held = Object.values(input.observation.chips?.[round - 1] ?? {});
      const free = examples.find(action => !held.includes(action.rank)); if (free) return clone(free);
    }
    if (entry.type === 'distress_vote') {
      const noHelp = examples.find(action => action.direction === 'none');
      // Repeatedly changing an already-cast no-help vote prevents unanimity.
      if (!noHelp) continue; return clone(noHelp);
    }
    if (entry.type === 'choose_start') return clone(examples.find(action => action.player === input.playerId) ?? examples[0]);
    if (entry.type === 'star_vote') return clone(examples.find(action => action.agree === true) ?? examples[0]);
    return clone(examples[0]);
  } return null;
};

/** The scheduler sees action TYPE names, never card values or player views.
 * It prefers progress over optional chat/reordering and cycles equal candidates. */
export const mechanicalScheduler: LocalScheduler = input => {
  const scored = input.candidates.map(c => ({ playerId: c.playerId, rank: Math.min(Infinity, ...c.actionTypes.map(priority)) }));
  const best = Math.min(Infinity, ...scored.map(c => c.rank)); if (!Number.isFinite(best)) return null;
  const eligible = new Set(scored.filter(c => c.rank === best).map(c => c.playerId));
  const previous = input.activePlayerIds.indexOf(input.previousPlayerId ?? '');
  for (let i = 1; i <= input.activePlayerIds.length; i++) {
    const id = input.activePlayerIds[(previous + i) % input.activePlayerIds.length]; if (eligible.has(id)) return id;
  } return null;
};

/** Give every active player with an available action a turn to decide, including
 * players whose only action is communication. Action names have no priority.
 * This is a local callback schedule, not a change to the game's turn rules. */
export const fairScheduler: LocalScheduler = input => {
  const eligible = new Set(input.candidates.filter(candidate => candidate.actionTypes.length > 0).map(candidate => candidate.playerId));
  const previous = input.activePlayerIds.indexOf(input.previousPlayerId ?? '');
  for (let i = 1; i <= input.activePlayerIds.length; i++) {
    const id = input.activePlayerIds[(previous + i) % input.activePlayerIds.length];
    if (eligible.has(id)) return id;
  }
  return null;
};

/** Rules-only local rollout. Seeds and full state are trusted-runner inputs and
 * remain inside the audit output; callbacks receive only a player's own view. */
export async function runLocalEpisode(game: GameAdapter, options: LocalRunOptions): Promise<LocalRunResult> {
  const maxActions = budget(options.maxActions, 500, 'maxActions');
  const maxTimeAdvances = budget(options.maxTimeAdvances, maxActions + 1, 'maxTimeAdvances');
  const clockStepMs = budget(options.clockStepMs, 0, 'clockStepMs');
  if (game.advanceTime && clockStepMs === 0) throw new Error('A real-time adapter requires an explicit positive clockStepMs for local simulated-clock runs.');
  const purpose = options.purpose ?? (options.policy || options.policies ? 'policy-evaluation' : 'mechanical-smoke');
  if (purpose === 'policy-evaluation') {
    const missing = Array.from({ length: options.setup.playerCount }, (_, i) => `p${i + 1}`)
      .filter(playerId => typeof (options.policies?.[playerId] ?? options.policy) !== 'function');
    if (missing.length) throw new Error(`Policy evaluation requires an explicit policy for every player; missing: ${missing.join(', ')}.`);
  }
  const setup = clone(options.setup); const partitionFamily = localDigest({ sourceSeed: setup.seed }); let state = game.setup(setup);
  const initialStateHash = localDigest(state); let outcome = game.outcome(state);
  const observations = observationFeed(game, setup.playerCount); observations.capture(state);
  const events: LocalEvent[] = []; const trainingRows: LocalTrainingRow[] = [];
  const pending = new Map<string, LocalTrainingRow>(); const decisions = new Map<string, number>();
  // A declined call still consumes its feed. Preserve that endpoint for the
  // previous successful action's final truncated transition.
  const declinedHistories = new Map<string, JsonObject[]>();
  let actions = 0; let timeAdvances = 0; let previousPlayerId: string | null = null; let truncationReason: string | null = null;
  while (!outcome) {
    if (actions >= maxActions) { truncationReason = 'action-budget'; break; }
    if (game.advanceTime) {
      if (timeAdvances >= maxTimeAdvances) { truncationReason = 'clock-budget'; break; }
      const beforeHash = localDigest(state); const next = game.advanceTime(state, clockStepMs);
      if (localDigest(state) !== beforeHash) throw new Error('Adapter advanceTime mutated its input.');
      state = next; timeAdvances++;
      observations.capture(state);
      events.push({ kind: 'time', sequence: events.length, elapsedMs: clockStepMs, beforeHash, afterHash: localDigest(state) });
      outcome = game.outcome(state); if (outcome) break;
    }
    const activePlayerIds = game.activePlayers(state);
    const candidateMenus = activePlayerIds.map(playerId => ({ playerId, menu: game.legalActions(state, playerId) }));
    const scheduler = options.scheduler ?? (purpose === 'policy-evaluation' ? fairScheduler : mechanicalScheduler);
    // Only the mechanical scheduler suppresses an already-cast no-help vote.
    // Evaluated/custom schedulers receive every available action type.
    const candidates = candidateMenus.map(({ playerId, menu }) => ({ playerId, actionTypes: menu.filter(item => scheduler !== mechanicalScheduler || item.type !== 'distress_vote' || item.examples?.some(action => action.direction === 'none')).map(item => item.type) }));
    const playerId = scheduler(freeze(clone({ activePlayerIds, candidates, previousPlayerId })));
    if (!playerId) {
      if (game.advanceTime) continue;
      truncationReason = 'no-scheduled-action'; break;
    }
    if (!activePlayerIds.includes(playerId)) throw new Error(`Scheduler selected inactive player ${playerId}.`);
    const legalActions = candidateMenus.find(item => item.playerId === playerId)!.menu;
    if (!legalActions.length) throw new Error(`Scheduler selected player ${playerId} with an empty action menu.`);
    const observation = game.observe(state, playerId);
    const observationHistory = observations.take(playerId);
    const policy = options.policies?.[playerId] ?? options.policy ?? mechanicalPolicy;
    const input = freeze(clone({ gameId: game.metadata.id, scenarioId: setup.scenarioId, playerId, observation, observationHistory, legalActions }));
    const action = await policy(input);
    if (action === null) { declinedHistories.set(playerId, observationHistory); truncationReason = 'policy-declined'; break; }
    const beforeHash = localDigest(state); const next = game.step(state, playerId, clone(action));
    if (localDigest(state) !== beforeHash) throw new Error('Adapter step mutated its input.');
    const prior = pending.get(playerId);
    if (prior) { prior.nextObservation = clone(observation); prior.nextObservationHistory = clone(observationHistory); prior.nextLegalActions = clone(legalActions); prior.reward = 0; pending.delete(playerId); }
    events.push({ kind: 'action', sequence: events.length, playerId, action: clone(action), beforeHash, afterHash: localDigest(next), observationHash: localDigest(observation), observationHistoryHash: localDigest(observationHistory), legalActionsHash: localDigest(legalActions) });
    const decisionIndex = decisions.get(playerId) ?? 0; decisions.set(playerId, decisionIndex + 1);
    const row: LocalTrainingRow = {
      schemaVersion: 'coop-bench/local-transition/v2', purpose, partitionFamily, gameId: game.metadata.id, scenarioId: setup.scenarioId, playerId, decisionIndex,
      observation: clone(observation), observationHistory: clone(observationHistory), legalActions: clone(legalActions), action: clone(action),
      nextObservation: {}, nextObservationHistory: [], nextLegalActions: [], reward: null, terminated: false, truncated: false, outcome: null,
    };
    trainingRows.push(row); pending.set(playerId, row); state = next; actions++; previousPlayerId = playerId; outcome = game.outcome(state);
    observations.capture(state);
  }
  const terminated = outcome !== null; const truncated = !terminated;
  for (const [playerId, row] of pending) {
    row.nextObservation = clone(game.observe(state, playerId));
    row.nextObservationHistory = clone(declinedHistories.get(playerId) ?? observations.peek(playerId));
    row.nextLegalActions = terminated ? [] : clone(game.legalActions(state, playerId));
    row.terminated = terminated; row.truncated = truncated; row.outcome = safeOutcome(outcome);
    row.reward = !outcome || outcome.kind === 'score-only' ? null : Number(outcome.success);
  }
  const audit: LocalAudit = {
    schemaVersion: 'coop-bench/local-audit/v2', privileged: true, partitionFamily, gameId: game.metadata.id, setup,
    purpose, policyName: options.policyName ?? (options.policy || options.policies ? 'custom-policy' : 'mechanical-first-example'),
    maxActions, clockStepMs, maxTimeAdvances, initialStateHash, events, finalStateHash: localDigest(state),
    terminated, truncated, truncationReason, outcome: clone(outcome),
  };
  return { partitionFamily, gameId: game.metadata.id, scenarioId: setup.scenarioId, playerCount: setup.playerCount, actions, timeAdvances, simulatedElapsedMs: timeAdvances * clockStepMs, terminated, truncated, truncationReason, outcome: safeOutcome(outcome), audit, trainingRows };
}

/** Replay is privileged: the audit contains the seed and other actors' actions.
 * Returns only verification facts, never the reconstructed omniscient state. */
export function replayLocalAudit(game: GameAdapter, audit: LocalAudit) {
  if (audit.schemaVersion !== 'coop-bench/local-audit/v2' || audit.gameId !== game.metadata.id) throw new Error('Audit game/schema mismatch.');
  if (audit.partitionFamily !== localDigest({ sourceSeed: audit.setup.seed })) throw new Error('Initial state partition/seed mismatch.');
  let state = game.setup(clone(audit.setup));
  const observations = observationFeed(game, audit.setup.playerCount); observations.capture(state);
  if (localDigest(state) !== audit.initialStateHash) throw new Error('Initial state digest mismatch.');
  for (let i = 0; i < audit.events.length; i++) {
    const event = audit.events[i]; if (event.sequence !== i || localDigest(state) !== event.beforeHash) throw new Error(`Invalid event prefix at ${i}.`);
    if (game.outcome(state)) throw new Error(`Event ${i} appears after termination.`);
    if (event.kind === 'time') { if (!game.advanceTime || !Number.isSafeInteger(event.elapsedMs) || event.elapsedMs <= 0) throw new Error('Invalid clock event.'); state = game.advanceTime(state, event.elapsedMs); }
    else {
      if (!game.activePlayers(state).includes(event.playerId)) throw new Error(`Inactive actor at event ${i}.`);
      if (localDigest(game.observe(state, event.playerId)) !== event.observationHash || localDigest(game.legalActions(state, event.playerId)) !== event.legalActionsHash) throw new Error(`Player observation/action-menu mismatch at ${i}.`);
      if (localDigest(observations.take(event.playerId)) !== event.observationHistoryHash) throw new Error(`Player observation history mismatch at ${i}.`);
      state = game.step(state, event.playerId, clone(event.action));
    }
    if (localDigest(state) !== event.afterHash) throw new Error(`State digest mismatch after event ${i}.`);
    observations.capture(state);
  }
  const outcome = game.outcome(state);
  if (localDigest(state) !== audit.finalStateHash || localDigest(outcome) !== localDigest(audit.outcome)) throw new Error('Final digest/outcome mismatch.');
  if (audit.terminated !== (outcome !== null) || audit.truncated === audit.terminated) throw new Error('Invalid termination flags.');
  return { verified: true as const, events: audit.events.length, finalStateHash: audit.finalStateHash, outcome: safeOutcome(outcome) };
}
