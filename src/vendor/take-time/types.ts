export type PlayerId = string;
export type CardColor = 'solar' | 'lunar';
export type Phase = 'discussion' | 'playing' | 'resolution' | 'finished';
export interface GameConfig {
  playerCount: 2 | 3 | 4;
  clockId: '1-1';
  bonusTokens: number;
  /** Transport limit, not a tabletop rule. */
  maxMessageLength: number;
}
export type GameConfigInput = Partial<GameConfig>;
export interface Card { id: string; value: number; color: CardColor }
export type PlayerAction =
  | { type: 'speak'; text: string }
  | { type: 'look_hand' }
  | { type: 'place'; cardId: string; position: number; faceUp?: boolean };
export interface DiscussionMessage { index: number; playerId: PlayerId; text: string }
// Card color is visible on the back. Values are visible only when face up.
export interface PublicPlacement {
  turn: number; playerId: PlayerId; position: number;
  color: CardColor; faceUp: boolean; value: number | null;
}
export interface RevealedPlacement extends PublicPlacement { card: Card }
export interface GameResult {
  won: boolean;
  sums: number[];
  violations: string[];
  placements: RevealedPlacement[];
  rewards: Record<PlayerId, 0 | 1>;
}
export interface Rules {
  name: string;
  variant: 'official';
  config: GameConfig;
  deck: { maxCardValue: 12; copiesPerValue: 2; cardsPerGame: 12; segmentCount: 6 };
  clock: { id: '1-1'; title: string; maxSegmentSum: null; conditions: string[] };
  baseFaceUpLimit: number;
  faceUpLimit: number;
  instructions: string[];
}
export interface PublicState {
  phase: Phase;
  playerIds: PlayerId[];
  currentPlayerId: PlayerId | null;
  /** Multiple seats may discuss or volunteer the very first placement. */
  activePlayerIds: PlayerId[];
  starterPlayerId: PlayerId | null;
  lookedPlayerIds: PlayerId[];
  discussion: DiscussionMessage[];
  placements: PublicPlacement[];
  segmentCounts: number[];
  handCounts: Record<PlayerId, number>;
  reserveCounts: Record<PlayerId, number>;
  cardBacks: Record<PlayerId, { hand: CardColor[]; reserve: CardColor[] }>;
  faceUpRemaining: number;
  result: GameResult | null;
}
export interface PlayerObservation extends PublicState {
  playerId: PlayerId;
  rules: Rules;
  hand: Card[] | null;
  ownPlacements: RevealedPlacement[];
  legalActions: Array<'speak' | 'look_hand' | 'place'>;
}
export interface GameRecord {
  version: 2;
  seed: string;
  config: GameConfig;
  /** Full dealt packets: in two-player mode first 4 are hand, last 2 reserve. */
  initialHands: Record<PlayerId, Card[]>;
  actions: Array<{ playerId: PlayerId; action: PlayerAction }>;
  result: GameResult;
}
export interface AgentTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
