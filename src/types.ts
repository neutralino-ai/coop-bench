/** Executable adapter contract. Persistence/authentication belong to the authority. */
export type PlayerId = string;
export type Action = { type: string; [key: string]: unknown };
export type JsonObject = Record<string, any>;
export interface Source {
  title: string;
  url: string;
  kind: 'official-rulebook' | 'official-mission' | 'publisher' | 'research';
  verifiedAt: string;
}
export interface Scenario {
  id: string;
  name: string;
  provenance: 'official-mission' | 'official-random-setup' | 'research-generated';
  description: string;
  sourceUrl?: string;
}
export interface Metadata {
  id: string;
  name: string;
  players: number[];
  sources: Source[];
  scenarios: Scenario[];
  rulesSummary: string[];
  implementation: {
    fidelity: 'official-core' | 'official-scenario' | 'research-adaptation';
    implemented: string[];
    omitted: string[];
    verifier: 'exact' | 'objective-only';
    notes: string[];
  };
}
export interface SetupOptions {
  playerCount: number;
  seed: string;
  scenarioId: string;
  config?: JsonObject;
}
export interface LegalAction {
  type: string;
  description: string;
  /** JSON Schema for the full action, including type. Never list hidden values. */
  schema: JsonObject;
  examples?: Action[];
}
export interface Outcome {
  kind?: 'win' | 'loss' | 'score-only';
  success: boolean;
  score: number;
  maxScore?: number;
  reason: string;
  /** Only privileged records should receive this field. */
  details?: JsonObject;
}
/** State must be plain JSON. No clock, process, token, or random global reads in steps. */
export interface GameAdapter<State = any> {
  metadata: Metadata;
  setup(options: SetupOptions): State;
  observe(state: State, playerId: PlayerId): JsonObject;
  activePlayers(state: State): PlayerId[];
  legalActions(state: State, playerId: PlayerId): LegalAction[];
  /** Pure: clone before mutation. Rejected actions must leave the input untouched. */
  step(state: State, playerId: PlayerId, action: Action): State;
  outcome(state: State): Outcome | null;
  /** System-only official clock input, injected by the trusted runner. */
  advanceTime?(state: State, elapsedMs: number): State;
  /** Stable decision identity for real-time games: may omit the ticking clock,
   * but must retain board, permissions and outcome-affecting phase changes. */
  decisionContext?(state: State, playerId: PlayerId): unknown;
}
