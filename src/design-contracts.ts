/** V2 design contracts only. No server, storage implementation, or game is supplied here. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type SeatId = string;
export type Command = { type: string; args: { [key: string]: Json } };

export interface RulePackRef {
  gameId: string;
  edition: string;
  rulesVersion: string;
  engineBuild: string;
  scenarioId: string;
  componentDigest: string;
  randomAlgorithmVersion: string;
  provenance: 'official-scenario' | 'official-random-setup' | 'research-variant';
}

/** Trusted runner control interface. Public rule-defined probabilities may be projected;
 * private-state-conditioned distributions and unrevealed draws must not be exposed.
 */
export type Decision =
  | { kind: 'turn'; roundId: string; seats: SeatId[] }
  | { kind: 'simultaneous'; roundId: string; seats: SeatId[] }
  | { kind: 'chance'; requestId: string; specification: Json }
  | { kind: 'terminal' };

export type KernelInput =
  | { kind: 'player'; seat: SeatId; command: Command }
  | { kind: 'joint'; roundId: string; commands: Record<SeatId, Command> }
  | { kind: 'chance'; requestId: string; outcome: Json }
  | { kind: 'system'; eventId: string; windowId: string; logicalTime: number;
      event: Json }; // official timers/system triggers only; not runner budget truncation

/** Domain result is separate from benchmark reward and runner time limits. */
export interface DomainOutcome {
  result: 'win' | 'loss' | 'draw' | 'score-only' | 'resolution';
  officialScore?: number;
  resolution?: Json;
  verificationEvidence: Json; // privileged audit data, not an automatic public response
}

/** This is the complete player projection, not a filtered copy of the full state object. */
export interface GameView {
  public: Json;
  private: Json;
  ownActionWindow: Json;
  actionSchema: Json;
  /** Must mean submit-able under the player's information, not secretly successful. */
  admissibleActionHints?: Json;
}

export interface IntentValidation {
  admissible: boolean;
  /** Must be safe for this player; do not expose a hidden reason or object value. */
  publicErrorCode?: string;
}

/** Pure deterministic domain kernel: no database, network, wall clock, or global PRNG. */
export interface GameKernel<State extends Json> {
  readonly rules: RulePackRef;
  initialize(config: Json): State; // may produce an initial chance decision
  decision(state: State): Decision;
  project(state: State, viewer: SeatId): GameView;
  validateIntent(state: State, seat: SeatId, command: Command): IntentValidation;
  transition(state: State, input: KernelInput): State;
  outcome(state: State): DomainOutcome | null;
  checkInvariants(state: State): readonly string[];
}

/** Private record for a session authority, never a player-facing DTO. */
export interface EpisodeRecord<State extends Json> {
  episodeId: string;
  rules: RulePackRef;
  internalRevision: number;
  state: State;
  /** A simultaneous submission remains here until the joint action is resolved. */
  pending: Record<SeatId, Command>;
  privateRandomState: Json;
  lifecycle: 'active' | 'terminated' | 'truncated' | 'cancelled';
  parentBranch?: { episodeId: string; checkpointId: string };
}

/** Token binds episode, authenticated seat, decision generation and visible generation. */
export interface ObservationEnvelope {
  episodeId: string;
  observationId: string; // issued payload record; not proof a human/model read it
  decisionToken: string; // opaque authenticated token; not internalRevision
  view: GameView;
  status: 'active' | 'terminated' | 'truncated' | 'cancelled';
  reward?: number;
  rewardPolicyVersion: string;
  truncationReason?: string;
}

/** Seat identity comes from authenticated transport context, never this JSON. */
export interface SubmitCommandRequest {
  decisionToken: string;
  observationId: string;
  command: Command;
}

export interface SubmitCommandResponse {
  receiptId: string;
  observation: ObservationEnvelope;
}

/** Network/DB details are adapters. Implementations must satisfy atomic commit contracts. */
export interface EpisodeAuthority {
  observe(identity: Json, episodeId: string): Promise<ObservationEnvelope>;
  submit(identity: Json, episodeId: string, idempotencyKey: string,
    request: SubmitCommandRequest): Promise<SubmitCommandResponse>;
}

export interface PlayerTransition {
  episodeId: string;
  seat: SeatId;
  inputObservationId: string;
  issuedObservation: GameView;
  command: Command;
  nextObservation: GameView;
  reward: number;
  terminated: boolean;
  truncated: boolean;
  endReason?: 'official-result' | 'time-budget' | 'step-budget' | 'cancelled' | 'other';
  /** Corrupt/unreconstructable runs go to a failure manifest, not fabricated transitions. */
  dataValidity: 'complete';
  elapsedEnvironmentSteps: number;
  rewardPolicyVersion: string;
  partitionFamily: string;
  /** Optional self-reported decision summary, not hidden chain-of-thought. */
  decisionSummary?: string;
}
