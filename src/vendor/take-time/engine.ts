import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type {
  Card, GameConfig, GameConfigInput, GameRecord, GameResult, Phase,
  PlayerAction, PlayerObservation, PublicState, RevealedPlacement, Rules,
} from './types.ts';

const DEFAULT_CONFIG: GameConfig = {
  playerCount: 3, clockId: '1-1', bonusTokens: 0, maxMessageLength: 2000,
};

export class GameError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'GameError';
    this.code = code;
    this.status = status;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, allowed: string[], code: string): void {
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))) {
    throw new GameError(code, `Only these fields are allowed: ${allowed.join(', ')}.`);
  }
}

function configFrom(input: GameConfigInput): GameConfig {
  if (!isObject(input)) throw new GameError('INVALID_CONFIG', 'Configuration must be an object.');
  exactKeys(input, Object.keys(DEFAULT_CONFIG), 'INVALID_CONFIG');
  const config = { ...DEFAULT_CONFIG, ...input };
  if (![2, 3, 4].includes(config.playerCount)) {
    throw new GameError('INVALID_CONFIG', 'playerCount must be 2, 3, or 4.');
  }
  if (config.clockId !== '1-1') {
    throw new GameError('INVALID_CONFIG', 'Only official clock 1-1 is implemented.');
  }
  if (!Number.isInteger(config.bonusTokens) || config.bonusTokens < 0 || config.bonusTokens > 3) {
    throw new GameError('INVALID_CONFIG', 'bonusTokens must be an integer from 0 to 3.');
  }
  if (!Number.isInteger(config.maxMessageLength) || config.maxMessageLength < 1 || config.maxMessageLength > 20000) {
    throw new GameError('INVALID_CONFIG', 'maxMessageLength must be an integer from 1 to 20000.');
  }
  return config;
}

function validateOptions(options: { seed?: string }): void {
  if (!isObject(options)) throw new GameError('INVALID_CONFIG', 'Options must be an object.');
  exactKeys(options, ['seed'], 'INVALID_CONFIG');
  if (options.seed !== undefined &&
      (typeof options.seed !== 'string' || options.seed.length === 0 || options.seed.length > 256)) {
    throw new GameError('INVALID_CONFIG', 'seed must be a nonempty string of at most 256 characters.');
  }
}

// The seed controls card values and colors, never their opaque identifiers.
function seededRandom(seed: string): () => number {
  let counter = 0;
  return () => createHmac('sha256', seed).update(String(counter++)).digest().readUIntBE(0, 6) / 281474976710656;
}

export class GameEngine {
  #config: GameConfig;
  #seed: string;
  #phase: Phase = 'discussion';
  #playerIds: string[];
  #looked = new Set<string>();
  #starterPlayerId: string | null = null;
  #discussion: PublicState['discussion'] = [];
  #placements: RevealedPlacement[] = [];
  #hands: Record<string, Card[]> = {};
  #reserves: Record<string, Card[]> = {};
  #initialHands: Record<string, Card[]> = {};
  #actions: GameRecord['actions'] = [];
  #result: GameResult | null = null;

  constructor(config: GameConfigInput = {}, options: { seed?: string } = {}) {
    this.#config = configFrom(config);
    validateOptions(options);
    this.#seed = options.seed ?? randomBytes(24).toString('hex');
    this.#playerIds = Array.from({ length: this.#config.playerCount }, (_, index) => `p${index + 1}`);
    const deck: Array<Omit<Card, 'id'>> = [];
    for (let value = 1; value <= 12; value++) {
      deck.push({ value, color: 'solar' }, { value, color: 'lunar' });
    }
    const random = seededRandom(this.#seed);
    for (let index = deck.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [deck[index], deck[other]] = [deck[other], deck[index]];
    }
    const packets: Record<string, Card[]> = Object.fromEntries(this.#playerIds.map(id => [id, []]));
    deck.slice(0, 12).forEach((card, index) => {
      packets[this.#playerIds[index % this.#playerIds.length]].push({ id: randomUUID(), ...card });
    });
    this.#initialHands = structuredClone(packets);
    for (const id of this.#playerIds) {
      this.#hands[id] = this.#config.playerCount === 2 ? packets[id].slice(0, 4) : packets[id];
      this.#reserves[id] = this.#config.playerCount === 2 ? packets[id].slice(4) : [];
    }
  }

  #baseFaceUpLimit(): number {
    // Reminder tokens: the team shares 2/3/4 face-up plays for 2/3/4 players.
    return this.#config.playerCount;
  }

  #faceUpRemaining(): number {
    return this.#baseFaceUpLimit() + this.#config.bonusTokens - this.#placements.filter(card => card.faceUp).length;
  }

  getRules(): Rules {
    return structuredClone({
      name: 'Take Time / 时序谜局',
      variant: 'official' as const,
      config: this.#config,
      deck: { maxCardValue: 12 as const, copiesPerValue: 2 as const, cardsPerGame: 12 as const, segmentCount: 6 as const },
      clock: {
        id: '1-1' as const, title: 'Chapter 1, clock 1', maxSegmentSum: null,
        conditions: ['Position 1 must contain exactly one card in total, and it must be solar.', 'Position 6 must contain exactly three cards in total, of either color.'],
      },
      baseFaceUpLimit: this.#baseFaceUpLimit(),
      faceUpLimit: this.#baseFaceUpLimit() + this.#config.bonusTokens,
      instructions: [
        'This implementation covers the official first clock (1-1), not the other clock boards or campaign progression.',
        'The deck contains 24 cards: solar 1–12 and lunar 1–12. Shuffle it and deal 12 cards; the remaining 12 are unused this attempt.',
        'The 12 cards are dealt face down before discussion. Before looking at your cards, discuss strategy freely in any order. Everyone may see every player’s solar/lunar card backs and count the two colors, including two-player reserves; dealt values stay hidden.',
        'Use look_hand to inspect your own hand. From that moment you must remain silent, even while players who have not looked continue discussing. Play begins once everyone has looked.',
        'No speech or other non-game signals may communicate card information after looking. Rearranging cards is not a communication channel.',
        this.#config.playerCount === 2
          ? 'Each player is dealt six cards: inspect only the first four, leaving two in reserve. Once both players have played two cards each, pick up the two reserve cards; they become visible only to their owner.'
          : `Each of the ${this.#config.playerCount} players receives ${12 / this.#config.playerCount} cards.`,
        `Any player may volunteer the first placement. The first successful place chooses the starter; subsequent turns follow ${this.#playerIds.join(' → ')} clockwise, wrapping around.`,
        'On your turn place exactly one card from your hand at position 1–6. Card color, player, destination, and whether it is face up are public; face-down values and IDs are hidden from other players.',
        `The team may place up to ${this.#baseFaceUpLimit() + this.#config.bonusTokens} cards face up in this attempt (${this.#baseFaceUpLimit()} base plus ${this.#config.bonusTokens} bonus tokens); all other placements must be face down.`,
        'After all 12 cards are placed, resolve and reveal them. Every position must be nonempty, and sums must satisfy sum(1) <= sum(2) <= ... <= sum(6); equality is allowed.',
        'On clock 1-1, position 1 must have exactly one card total and that card must be solar; position 6 must have exactly three cards total, of either color.',
        'The usual maximum position sum of 24 does not apply to the first three introductory clocks; there is no sum cap on this first clock.',
        'Everyone wins together when all conditions hold, otherwise everyone loses. After a loss, retry shuffles and redeals with one additional bonus token, to a maximum of three tokens.',
      ],
    });
  }

  #assertPlayer(playerId: string): void {
    if (!this.#playerIds.includes(playerId)) throw new GameError('INVALID_PLAYER', 'Unknown player ID.', 404);
  }

  #currentPlayerId(): string | null {
    if (this.#phase !== 'playing' || this.#starterPlayerId === null) return null;
    const start = this.#playerIds.indexOf(this.#starterPlayerId);
    return this.#playerIds[(start + this.#placements.length) % this.#playerIds.length];
  }

  #activePlayerIds(): string[] {
    if (this.#phase === 'discussion') return this.#playerIds.filter(id => !this.#looked.has(id));
    if (this.#phase === 'playing') {
      const current = this.#currentPlayerId();
      return current === null ? [...this.#playerIds] : [current];
    }
    return [];
  }

  getPublicState(): PublicState {
    const segmentCounts = Array(6).fill(0) as number[];
    for (const placement of this.#placements) segmentCounts[placement.position - 1] += 1;
    return structuredClone({
      phase: this.#phase,
      playerIds: this.#playerIds,
      currentPlayerId: this.#currentPlayerId(),
      activePlayerIds: this.#activePlayerIds(),
      starterPlayerId: this.#starterPlayerId,
      lookedPlayerIds: this.#playerIds.filter(id => this.#looked.has(id)),
      discussion: this.#discussion,
      placements: this.#placements.map(({ turn, playerId, position, color, faceUp, card }) => ({
        turn, playerId, position, color, faceUp,
        value: faceUp || this.#phase === 'finished' ? card.value : null,
      })),
      segmentCounts,
      handCounts: Object.fromEntries(this.#playerIds.map(id => [id, this.#hands[id].length])),
      reserveCounts: Object.fromEntries(this.#playerIds.map(id => [id, this.#reserves[id].length])),
      cardBacks: Object.fromEntries(this.#playerIds.map(id => [id, {
        hand: this.#hands[id].map(card => card.color), reserve: this.#reserves[id].map(card => card.color),
      }])),
      faceUpRemaining: this.#faceUpRemaining(),
      result: this.#result,
    });
  }

  observe(playerId: string): PlayerObservation {
    this.#assertPlayer(playerId);
    const legalActions: PlayerObservation['legalActions'] = [];
    if (this.#phase === 'discussion' && !this.#looked.has(playerId)) legalActions.push('speak', 'look_hand');
    if (this.#phase === 'playing' && this.#activePlayerIds().includes(playerId)) legalActions.push('place');
    return structuredClone({
      ...this.getPublicState(), playerId, rules: this.getRules(),
      hand: this.#looked.has(playerId) ? this.#hands[playerId] : null,
      ownPlacements: this.#placements.filter(placement => placement.playerId === playerId),
      legalActions,
    });
  }

  act(playerId: string, action: unknown): PlayerObservation {
    this.#assertPlayer(playerId);
    if (!isObject(action)) throw new GameError('INVALID_ACTION', 'Action must be an object.');
    const allowed = action.type === 'speak' ? ['type', 'text']
      : action.type === 'look_hand' ? ['type']
        : action.type === 'place' ? ['type', 'cardId', 'position', 'faceUp'] : null;
    if (allowed === null) throw new GameError('INVALID_ACTION', 'Action type must be speak, look_hand, or place.');
    exactKeys(action, allowed, 'INVALID_ACTION');
    if ((action.type !== 'place' && this.#phase !== 'discussion') ||
        (action.type === 'place' && this.#phase !== 'playing')) {
      throw new GameError('WRONG_PHASE', `Cannot ${action.type} during ${this.#phase}.`, 409);
    }
    if (action.type === 'speak' || action.type === 'look_hand') {
      if (this.#looked.has(playerId)) {
        throw new GameError('HAND_ALREADY_LOOKED', 'After looking at your hand, you cannot speak or look again.', 409);
      }
      if (action.type === 'speak') {
        if (typeof action.text !== 'string' || action.text.trim().length === 0 || action.text.length > this.#config.maxMessageLength) {
          throw new GameError('INVALID_ACTION', `text must be nonblank and at most ${this.#config.maxMessageLength} characters.`);
        }
        this.#discussion.push({ index: this.#discussion.length + 1, playerId, text: action.text });
        this.#actions.push({ playerId, action: { type: 'speak', text: action.text } });
      } else {
        this.#looked.add(playerId);
        this.#actions.push({ playerId, action: { type: 'look_hand' } });
        if (this.#looked.size === this.#playerIds.length) this.#phase = 'playing';
      }
    } else {
      const current = this.#currentPlayerId();
      if (current !== null && current !== playerId) throw new GameError('NOT_YOUR_TURN', 'Wait until your turn.', 409);
      if (typeof action.cardId !== 'string' || !Number.isInteger(action.position) ||
          typeof action.position !== 'number' || action.position < 1 || action.position > 6 ||
          (Object.hasOwn(action, 'faceUp') && typeof action.faceUp !== 'boolean')) {
        throw new GameError('INVALID_ACTION', 'place requires a cardId, an integer position from 1 to 6, and optionally a boolean faceUp.');
      }
      const cardIndex = this.#hands[playerId].findIndex(card => card.id === action.cardId);
      if (cardIndex < 0) throw new GameError('CARD_NOT_IN_HAND', 'The selected card is not in your hand.');
      const faceUp = action.faceUp === true;
      if (faceUp && this.#faceUpRemaining() === 0) throw new GameError('FACE_UP_LIMIT', 'The shared face-up card allowance is exhausted.', 409);
      const committed: PlayerAction = { type: 'place', cardId: action.cardId, position: action.position, faceUp };
      // All validation precedes committing the starter, card movement, or action log.
      if (this.#starterPlayerId === null) this.#starterPlayerId = playerId;
      const [card] = this.#hands[playerId].splice(cardIndex, 1);
      this.#placements.push({ turn: this.#placements.length + 1, playerId, position: action.position, color: card.color, faceUp, value: card.value, card });
      this.#actions.push({ playerId, action: committed });
      if (this.#config.playerCount === 2 && this.#placements.length === 4) {
        for (const id of this.#playerIds) {
          this.#hands[id].push(...this.#reserves[id]);
          this.#reserves[id] = [];
        }
      }
      if (this.#placements.length === 12) this.#phase = 'resolution';
    }
    return this.observe(playerId);
  }

  resolve(): GameResult {
    if (this.#phase !== 'resolution') throw new GameError('WRONG_PHASE', 'The game can only resolve after all cards have been played.', 409);
    const sums = Array(6).fill(0) as number[];
    const counts = Array(6).fill(0) as number[];
    for (const placement of this.#placements) {
      sums[placement.position - 1] += placement.card.value;
      counts[placement.position - 1] += 1;
    }
    const violations: string[] = [];
    for (let index = 0; index < 6; index++) {
      if (counts[index] === 0) violations.push(`Position ${index + 1} is empty.`);
      if (index > 0 && sums[index - 1] > sums[index]) {
        violations.push(`Position ${index} sum ${sums[index - 1]} must be at most position ${index + 1} sum ${sums[index]}.`);
      }
    }
    if (counts[0] !== 1 || this.#placements.find(card => card.position === 1)?.color !== 'solar') {
      violations.push('Position 1 must contain exactly one card in total, and it must be solar.');
    }
    if (counts[5] !== 3) violations.push('Position 6 must contain exactly three cards in total, of either color.');
    const won = violations.length === 0;
    this.#result = {
      won, sums, violations, placements: structuredClone(this.#placements),
      rewards: Object.fromEntries(this.#playerIds.map(id => [id, won ? 1 : 0])) as GameResult['rewards'],
    };
    this.#phase = 'finished';
    return structuredClone(this.#result);
  }

  exportRecord(): GameRecord {
    if (this.#phase !== 'finished' || this.#result === null) {
      throw new GameError('GAME_NOT_FINISHED', 'A full record is available only after resolution.', 409);
    }
    return structuredClone({ version: 2 as const, seed: this.#seed, config: this.#config,
      initialHands: this.#initialHands, actions: this.#actions, result: this.#result });
  }

  retry(options: { seed?: string } = {}): GameEngine {
    if (this.#phase !== 'finished' || this.#result === null || this.#result.won) {
      throw new GameError('RETRY_NOT_ALLOWED', 'A fresh attempt with a bonus token is available only after a resolved loss.', 409);
    }
    return new GameEngine({ ...this.#config, bonusTokens: Math.min(3, this.#config.bonusTokens + 1) }, options);
  }
}
