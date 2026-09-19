import { actionKeys, check, clone, exactKeys, legal, makeRng, nextPlayer, players, shuffle } from '../common.ts';
import type { Action, GameAdapter, LegalAction, Metadata, Outcome, SetupOptions } from '../types.ts';

export type CrewSuit = 'blue' | 'green' | 'pink' | 'yellow' | 'trump';
export interface CrewCard { id: string; suit: CrewSuit; value: number }
interface Play { playerId: string; card: CrewCard }
interface Task { id: string; card: CrewCard; owner: string | null; order: number | null; completed: boolean }
type Signal = 'highest' | 'lowest' | 'only';
type Direction = 'none' | 'left' | 'right';
export interface CrewState {
  rulesetId: string;
  kind: 'deep-sea' | 'planet-nine';
  scenarioId: string;
  players: string[];
  hands: Record<string, CrewCard[]>;
  phase: 'task-selection' | 'distress-decision' | 'distress-exchange' | 'play' | 'ended';
  captain: string;
  currentPlayer: string;
  tasks: Task[];
  targetTricks: number;
  trick: Play[];
  lastTrick: { plays: Play[]; winner: string } | null;
  tricksCompleted: number;
  totalTricks: number;
  tricksWon: Record<string, number>;
  communication: Record<string, { used: boolean; card: CrewCard | null; relation: Signal | null }>;
  distress: {
    votes: Record<string, Direction | null>;
    direction: Direction | null;
    selected: Record<string, string | null>;
    used: boolean;
  };
  redeals: number;
  result: Outcome | null;
}

const VERIFIED = '2026-09-16';
const DEEP_RULES = 'https://www.thamesandkosmos.co.uk/wp-content/uploads/2021/02/691869_Crew_Deep-Sea_Manual.pdf';
const PLANET_RULES = 'https://www.thamesandkosmos.com/manuals/full/691868_Crew_Manual.pdf';
const PROMO = 'https://cms.kosmos.de/Downloads/Die%20Crew/Crew_2_Promo_Cards_DE.pdf';
const LOGBOOK = 'https://iello.fr/wp-content/uploads/2020/05/The-Crew_Log-Book.pdf';

/** The two editions have the same abstract 40-card playing deck. No artwork is copied. */
export function crewDeck(): CrewCard[] {
  return (['blue', 'green', 'pink', 'yellow', 'trump'] as CrewSuit[]).flatMap(suit =>
    Array.from({ length: suit === 'trump' ? 4 : 9 }, (_, index) => ({ id: `${suit}-${index + 1}`, suit, value: index + 1 })));
}

function metadata(kind: CrewState['kind']): Metadata {
  const deep = kind === 'deep-sea';
  return {
    id: deep ? 'crew-deep-sea' : 'crew-planet-nine',
    name: deep ? 'The Crew: Mission Deep Sea — official Promo 1' : 'The Crew: The Quest for Planet Nine — official Missions 1–3',
    players: [3, 4, 5],
    sources: [
      { title: deep ? 'Kosmos English Deep Sea rules' : 'Kosmos English Planet Nine rules', url: deep ? DEEP_RULES : PLANET_RULES, kind: 'official-rulebook', verifiedAt: VERIFIED },
      { title: deep ? 'Kosmos Promo missions (2021), page 2' : 'IELLO official French logbook excerpt, page 4', url: deep ? PROMO : LOGBOOK, kind: 'official-mission', verifiedAt: VERIFIED },
    ],
    scenarios: deep ? [
      { id: 'official-promo-1', name: 'Promo 1: Captain for a Day (2 tricks)', provenance: 'official-mission', sourceUrl: PROMO, description: 'Submarine 1 holder leads; win exactly two tricks containing no 7, 8 or 9.' },
      { id: 'official-promo-1-three-tricks', name: 'Promo 1: official follow-up (3 tricks)', provenance: 'official-mission', sourceUrl: PROMO, description: 'The same official Promo with its printed follow-up target of three tricks.' },
    ] : [1, 2, 3].map(number => ({
      id: `official-mission-${number}`, name: `Mission ${number}`, provenance: 'official-mission' as const, sourceUrl: LOGBOOK,
      description: number === 1 ? 'One randomly drawn task, taken by the commander.' : number === 2 ? 'Two randomly drawn tasks, selected clockwise from the commander.' : 'Two tasks carrying order tokens 1 and 2.',
    })),
    rulesSummary: [
      'Four colors numbered 1–9 and four trumps numbered 1–4; follow the led suit when possible, otherwise any card.',
      'Highest trump wins; without trump, highest card of the led color wins. Winner leads next.',
      'Private hands; one truthful non-trump highest/lowest/only signal per player per attempt, only between tricks after task assignment.',
      'Optional distress assistance is decided before signals or tricks; everyone passes one non-trump in the same direction simultaneously.',
      deep ? 'Promo captain holds trump 1; redeal if that player holds all four trumps. Exact trick target is checked at the end.' : 'Commander holds trump 4. Tasks cannot be passed during selection. Wrong task owner or wrong task order loses.',
    ],
    implementation: {
      fidelity: 'official-scenario', verifier: 'exact',
      implemented: ['Complete 40-card playing deck', '3/4/5-player standard deal', 'Follow suit and trump resolution', 'Between-trick signaling', 'Optional distress card exchange', deep ? 'Official Promo 1 and its printed three-trick follow-up' : 'Official Missions 1, 2 and 3; complete 36-card task deck'],
      omitted: [deep ? '96-card main task deck, main campaign and Promo 2' : 'Missions 4–50 and other extra missions', '2-player virtual crew variant', 'Optional 3-player reduced-deck challenge', 'Cross-attempt campaign bookkeeping'],
      notes: ['One environment episode is one attempt. Distress use adds one to this attempt’s logbook cost; a campaign manager must preserve distress activation over retries.', 'Only the latest completed trick can be inspected in a fresh observation. Agents may remember their earlier observations.', 'No unrestricted chat is offered after dealing. General pre-deal discussion belongs in the external lobby.', 'Distress votes and unanimous agreement are transport controls. Card selections stay private until all submissions are locked.'],
    },
  };
}

function setup(kind: CrewState['kind'], options: SetupOptions): CrewState {
  check([3, 4, 5].includes(options.playerCount), 'This ruleset supports 3, 4 or 5 players.', 'INVALID_SETUP');
  check(metadata(kind).scenarios.some(item => item.id === options.scenarioId), 'Unsupported official scenario.', 'INVALID_SETUP');
  if (options.config !== undefined) exactKeys(options.config, []);
  const ids = players(options.playerCount);
  const rng = makeRng(`crew/${kind}/${options.seed}`);
  let hands: Record<string, CrewCard[]>;
  let captain: string;
  let redeals = 0;
  do {
    hands = Object.fromEntries(ids.map(id => [id, []]));
    shuffle(crewDeck(), rng).forEach((card, index) => hands[ids[index % ids.length]].push(card));
    captain = ids.find(id => hands[id].some(card => card.id === (kind === 'deep-sea' ? 'trump-1' : 'trump-4')))!;
    if (kind !== 'deep-sea' || hands[captain].filter(card => card.suit === 'trump').length !== 4) break;
    redeals++;
  } while (true);
  const taskCount = kind === 'deep-sea' ? 0 : options.scenarioId === 'official-mission-1' ? 1 : 2;
  const tasks = shuffle(crewDeck().filter(card => card.suit !== 'trump'), rng).slice(0, taskCount).map((card, index) => ({
    id: `task-${index + 1}`, card, owner: null,
    order: options.scenarioId === 'official-mission-3' ? index + 1 : null, completed: false,
  }));
  return {
    rulesetId: `crew-${kind}/official-v1`, kind, scenarioId: options.scenarioId, players: ids, hands,
    phase: taskCount ? 'task-selection' : 'distress-decision', captain, currentPlayer: captain,
    tasks, targetTricks: options.scenarioId === 'official-promo-1-three-tricks' ? 3 : 2,
    trick: [], lastTrick: null, tricksCompleted: 0, totalTricks: Math.floor(40 / ids.length),
    tricksWon: Object.fromEntries(ids.map(id => [id, 0])),
    communication: Object.fromEntries(ids.map(id => [id, { used: false, card: null, relation: null }])),
    distress: { votes: Object.fromEntries(ids.map(id => [id, null])), direction: null, selected: Object.fromEntries(ids.map(id => [id, null])), used: false },
    redeals, result: null,
  };
}

function signals(state: CrewState, playerId: string): Action[] {
  if (state.phase !== 'play' || state.trick.length !== 0 || state.communication[playerId].used) return [];
  const hand = state.hands[playerId];
  return hand.filter(card => card.suit !== 'trump').flatMap(card => {
    const same = hand.filter(other => other.suit === card.suit);
    const relation: Signal | null = same.length === 1 ? 'only' : card.value === Math.max(...same.map(other => other.value)) ? 'highest' : card.value === Math.min(...same.map(other => other.value)) ? 'lowest' : null;
    return relation ? [{ type: 'communicate', cardId: card.id, relation }] : [];
  });
}

function playable(state: CrewState, playerId: string): CrewCard[] {
  if (state.phase !== 'play' || state.currentPlayer !== playerId) return [];
  const hand = state.hands[playerId];
  const matching = state.trick.length ? hand.filter(card => card.suit === state.trick[0].card.suit) : [];
  return matching.length ? matching : hand;
}

function activePlayers(state: CrewState): string[] {
  if (state.result) return [];
  if (state.phase === 'task-selection') return [state.currentPlayer];
  if (state.phase === 'distress-decision') return [...state.players];
  if (state.phase === 'distress-exchange') return state.players.filter(id => state.distress.selected[id] === null);
  // Potential signal actors depend only on public token state, never on hidden suit composition.
  return [state.currentPlayer, ...state.players.filter(id => id !== state.currentPlayer && state.trick.length === 0 && !state.communication[id].used)];
}

function legalActions(state: CrewState, playerId: string): LegalAction[] {
  check(state.players.includes(playerId), 'Unknown player.', 'UNKNOWN_PLAYER');
  if (state.result) return [];
  if (state.phase === 'task-selection') {
    if (playerId !== state.currentPlayer) return [];
    const ids = state.tasks.filter(task => task.owner === null).map(task => task.id);
    return [legal('select_task', 'Take one face-up task; Planet Nine does not permit passing.', { taskId: { enum: ids } }, undefined, ids.map(taskId => ({ type: 'select_task', taskId })))];
  }
  if (state.phase === 'distress-decision') {
    const directions = (['none', 'left', 'right'] as Direction[]).filter(direction => state.distress.votes[playerId] !== direction);
    return [legal('distress_vote', 'Agree on no help, or on one direction for the optional exchange. Unanimity starts the next phase.', { direction: { enum: directions } }, undefined, directions.map(direction => ({ type: 'distress_vote', direction })))];
  }
  if (state.phase === 'distress-exchange') {
    if (state.distress.selected[playerId] !== null) return [];
    const cards = state.hands[playerId].filter(card => card.suit !== 'trump');
    return [legal('distress_pass', 'Privately commit one non-trump. All cards move simultaneously after the final commitment.', { cardId: { enum: cards.map(card => card.id) } }, undefined, cards.map(card => ({ type: 'distress_pass', cardId: card.id })))];
  }
  const result: LegalAction[] = [];
  const cards = playable(state, playerId);
  if (cards.length) result.push(legal('play', 'Play a card; follow the led suit if you can.', { cardId: { enum: cards.map(card => card.id) } }, undefined, cards.map(card => ({ type: 'play', cardId: card.id }))));
  const options = signals(state, playerId);
  if (options.length) result.push(legal('communicate', 'Reveal one ordinary card and its truthful relation; one signal per attempt, between tricks only.', {
    cardId: { enum: options.map(action => action.cardId) }, relation: { enum: ['highest', 'lowest', 'only'] },
  }, undefined, options));
  return result;
}

function end(state: CrewState, success: boolean, reason: string): void {
  state.phase = 'ended';
  state.result = { success, score: success ? 1 : 0, maxScore: 1, reason, details: {
    scenarioId: state.scenarioId, tricksCompleted: state.tricksCompleted, tricksWon: clone(state.tricksWon),
    distressUsed: state.distress.used, attemptLogbookCost: 1 + Number(state.distress.used),
  } };
}

export function crewTrickWinner(trick: readonly Play[]): string {
  check(trick.length > 0, 'Cannot resolve an empty trick.', 'INTERNAL');
  const trumps = trick.filter(play => play.card.suit === 'trump');
  const eligible = trumps.length ? trumps : trick.filter(play => play.card.suit === trick[0].card.suit);
  return eligible.reduce((best, play) => play.card.value > best.card.value ? play : best).playerId;
}

function finishTrick(state: CrewState): void {
  const winner = crewTrickWinner(state.trick);
  const completed = state.trick;
  state.lastTrick = { plays: completed, winner };
  state.trick = [];
  state.tricksCompleted++;
  state.tricksWon[winner]++;
  state.currentPlayer = winner;
  if (state.kind === 'planet-nine') {
    const wonTasks = state.tasks.filter(task => !task.completed && completed.some(play => play.card.id === task.card.id));
    if (wonTasks.some(task => task.owner !== winner)) return end(state, false, 'A task card was captured by the wrong player.');
    for (const task of wonTasks) {
      if (task.order !== null && state.tasks.some(prior => prior.order !== null && prior.order < task.order! && !prior.completed && !wonTasks.includes(prior))) {
        return end(state, false, 'A numbered task was completed before an earlier task.');
      }
    }
    wonTasks.forEach(task => { task.completed = true; });
    if (state.tasks.every(task => task.completed)) return end(state, true, 'All assigned tasks were completed in the required order.');
    if (state.tricksCompleted === state.totalTricks) return end(state, false, 'The final trick ended with a task unfinished.');
  } else {
    if (winner === state.captain && completed.some(play => play.card.value >= 7)) return end(state, false, 'The captain captured a 7, 8 or 9.');
    const won = state.tricksWon[state.captain];
    if (won > state.targetTricks) return end(state, false, 'The captain exceeded the exact trick target.');
    if (state.tricksCompleted === state.totalTricks) return end(state, won === state.targetTricks, won === state.targetTricks ? 'Captain met the exact trick target without 7, 8 or 9.' : 'Captain did not reach the exact trick target.');
    if (won + state.totalTricks - state.tricksCompleted < state.targetTricks) return end(state, false, 'Too few tricks remain to reach the target.');
  }
}

function step(input: CrewState, playerId: string, action: Action): CrewState {
  check(input.players.includes(playerId), 'Unknown player.', 'UNKNOWN_PLAYER');
  check(!input.result, 'This attempt has ended.', 'GAME_OVER');
  const state = clone(input);
  if (action.type === 'select_task') {
    actionKeys(action, 'select_task', ['taskId']);
    check(state.phase === 'task-selection' && state.currentPlayer === playerId, 'Not your task selection turn.');
    const task = state.tasks.find(task => task.id === action.taskId && task.owner === null);
    check(task, 'Choose an available task.');
    task.owner = playerId;
    if (state.tasks.every(task => task.owner !== null)) { state.phase = 'distress-decision'; state.currentPlayer = state.captain; }
    else state.currentPlayer = nextPlayer(state.players, playerId);
  } else if (action.type === 'distress_vote') {
    actionKeys(action, 'distress_vote', ['direction']);
    check(state.phase === 'distress-decision', 'Distress decision must precede all communication and play.');
    check(['none', 'left', 'right'].includes(action.direction as string), 'Unknown direction.');
    check(state.distress.votes[playerId] !== action.direction, 'Your unchanged vote is already recorded.');
    state.distress.votes[playerId] = action.direction as Direction;
    if (state.players.every(id => state.distress.votes[id] === action.direction)) {
      state.distress.direction = action.direction as Direction;
      state.distress.used = action.direction !== 'none';
      state.phase = state.distress.used ? 'distress-exchange' : 'play';
    }
  } else if (action.type === 'distress_pass') {
    actionKeys(action, 'distress_pass', ['cardId']);
    check(state.phase === 'distress-exchange', 'No distress exchange is in progress.');
    check(state.distress.selected[playerId] === null, 'Your card is already committed.');
    check(state.hands[playerId].some(card => card.id === action.cardId && card.suit !== 'trump'), 'Choose one of your ordinary color cards.');
    state.distress.selected[playerId] = action.cardId as string;
    if (state.players.every(id => state.distress.selected[id] !== null)) {
      const transfers = state.players.map(id => state.hands[id].find(card => card.id === state.distress.selected[id])!);
      for (const id of state.players) state.hands[id] = state.hands[id].filter(card => card.id !== state.distress.selected[id]);
      state.players.forEach((id, index) => {
        const direction = state.distress.direction === 'left' ? 1 : -1;
        const recipient = state.players[(index + direction + state.players.length) % state.players.length];
        state.hands[recipient].push(transfers[index]);
      });
      state.phase = 'play';
    }
  } else if (action.type === 'communicate') {
    actionKeys(action, 'communicate', ['cardId', 'relation']);
    check(signals(state, playerId).some(option => option.cardId === action.cardId && option.relation === action.relation), 'That signal is not legal now.');
    state.communication[playerId] = { used: true, card: state.hands[playerId].find(card => card.id === action.cardId)!, relation: action.relation as Signal };
  } else if (action.type === 'play') {
    actionKeys(action, 'play', ['cardId']);
    const card = playable(state, playerId).find(card => card.id === action.cardId);
    check(card, 'That card cannot be played now; check turn, ownership and led suit.');
    state.hands[playerId] = state.hands[playerId].filter(other => other.id !== card.id);
    if (state.communication[playerId].card?.id === card.id) state.communication[playerId].card = null;
    state.trick.push({ playerId, card });
    if (state.trick.length === state.players.length) finishTrick(state);
    else state.currentPlayer = nextPlayer(state.players, playerId);
  } else check(false, 'Unknown Crew action.');
  return state;
}

function observe(state: CrewState, playerId: string) {
  check(state.players.includes(playerId), 'Unknown player.', 'UNKNOWN_PLAYER');
  return clone({
    rulesetId: state.rulesetId, gameId: `crew-${state.kind}`, scenarioId: state.scenarioId, playerId,
    phase: state.phase, players: state.players, captain: state.captain,
    currentPlayer: state.phase === 'play' || state.phase === 'task-selection' ? state.currentPlayer : null,
    hand: state.hands[playerId], handSizes: Object.fromEntries(state.players.map(id => [id, state.hands[id].length])),
    tasks: state.tasks, trick: state.trick, lastTrick: state.lastTrick,
    tricksCompleted: state.tricksCompleted, totalTricks: state.totalTricks, tricksWon: state.tricksWon,
    communication: state.communication,
    objective: state.kind === 'deep-sea' ? { owner: state.captain, exactTricks: state.targetTricks, forbiddenValues: [7, 8, 9] } : { type: 'capture-assigned-tasks' },
    distress: {
      votes: state.distress.votes, direction: state.distress.direction, used: state.distress.used,
      ownCommittedCard: state.phase === 'distress-exchange' ? state.distress.selected[playerId] : null,
    },
    communicationPolicy: { freeChat: false, structuredSignals: state.phase === 'play' && state.trick.length === 0, privateDistressCommitments: state.phase === 'distress-exchange' },
    outcome: state.result ? { success: state.result.success, score: state.result.score, maxScore: state.result.maxScore, reason: state.result.reason } : null,
  });
}

function decisionWindow(s:CrewState):{key:string;players:string[];mode:'all'} {
  return {key:`${s.phase}:${s.currentPlayer}:${s.trick.length}`,mode:'all',players:s.phase==='distress-decision'?s.players:s.phase==='distress-exchange'?s.players.filter(p=>s.distress.selected[p]===null):[s.currentPlayer]};
}
export const crewDeepSea: GameAdapter<CrewState> = { metadata: metadata('deep-sea'), setup: options => setup('deep-sea', options), observe, activePlayers, decisionWindow, legalActions, step, outcome: state => state.result === null ? null : clone(state.result) };
export const crewPlanetNine: GameAdapter<CrewState> = { metadata: metadata('planet-nine'), setup: options => setup('planet-nine', options), observe, activePlayers, decisionWindow, legalActions, step, outcome: state => state.result === null ? null : clone(state.result) };
