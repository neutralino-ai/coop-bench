import type { Action, GameAdapter, LegalAction, Outcome } from '../types.ts';
import { actionKeys, check, clone, exactKeys, integer, legal, makeRng, players, shuffle, textValue } from '../common.ts';

const SOURCE = 'https://ludovox.fr/wp-content/uploads/ressources/MM_Print%26Play.pdf';
const COLORS = ['red', 'yellow', 'green', 'blue'];
const DIRS = ['N', 'E', 'S', 'W'];
const DELTA: Record<string, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const DURATION = 180000;
type Point = [number, number];
type Feature = { at: Point; kind: 'teleport' | 'explore' | 'item' | 'timer' | 'exit'; color?: string; dir?: string };
type Tile = { id: number; rows: string[]; walls: [Point, Point][]; features: Feature[]; stairs: [Point, Point][] };
const f = (x: number, y: number, kind: Feature['kind'], color?: string, dir?: string): Feature => ({ at: [x, y], kind, ...(color ? { color } : {}), ...(dir ? { dir } : {}) });

/** Numeric topology transcribed from the publisher-authored PnP, printed pp. 8–9.
 * The work-in-progress demo differs from the retail game's map and colours. */
export const MAGIC_MAZE_TILES: Tile[] = [
  { id: 1, rows: ['....', '....', '....', '...#'], walls: [[[0, 0], [0, 1]], [[3, 0], [3, 1]], [[0, 1], [0, 2]], [[3, 1], [3, 2]], [[0, 2], [0, 3]], [[2, 2], [3, 2]]], features: [f(0, 0, 'timer'), f(2, 0, 'explore', 'red', 'N'), f(0, 1, 'explore', 'blue', 'W'), f(3, 2, 'explore', 'green', 'E'), f(1, 3, 'explore', 'yellow', 'S'), f(3, 0, 'teleport', 'blue'), f(3, 1, 'teleport', 'yellow'), f(0, 2, 'teleport', 'red'), f(0, 3, 'teleport', 'green')], stairs: [[[2, 3], [3, 2]]] },
  { id: 2, rows: ['##..', '.##.', '..##', '...#'], walls: [[[0, 3], [1, 3]]], features: [f(0, 1, 'explore', 'red', 'W'), f(3, 1, 'exit'), f(0, 3, 'teleport', 'green'), f(2, 3, 'teleport', 'blue')], stairs: [[[0, 1], [2, 0]]] },
  { id: 3, rows: ['...#', '....', '....', '#..#'], walls: [[[1, 0], [2, 0]], [[0, 1], [1, 1]], [[0, 1], [0, 2]], [[2, 1], [2, 2]], [[3, 1], [3, 2]], [[1, 2], [1, 3]]], features: [f(2, 0, 'teleport', 'red'), f(0, 1, 'explore', 'blue', 'W'), f(3, 1, 'teleport', 'green'), f(0, 2, 'timer'), f(3, 2, 'explore', 'yellow', 'E')], stairs: [] },
  { id: 4, rows: ['##..', '#..#', '....', '#.##'], walls: [[[1, 1], [2, 1]]], features: [f(2, 0, 'explore', 'blue', 'N'), f(3, 0, 'teleport', 'yellow'), f(1, 1, 'timer'), f(0, 2, 'teleport', 'red'), f(3, 2, 'explore', 'green', 'E')], stairs: [] },
  { id: 5, rows: ['....', '....', '....', '#..#'], walls: [[[1, 0], [2, 0]], [[0, 1], [1, 1]], [[0, 1], [0, 2]], [[1, 1], [2, 1]], [[2, 0], [2, 1]], [[2, 1], [3, 1]], [[1, 2], [1, 3]]], features: [f(2, 0, 'explore', 'red', 'N'), f(0, 1, 'explore', 'yellow', 'W'), f(2, 1, 'timer'), f(0, 2, 'teleport', 'blue'), f(3, 2, 'explore', 'green', 'E')], stairs: [] },
  { id: 6, rows: ['#.##', '...#', '#...', '..##'], walls: [[[1, 1], [1, 2]]], features: [f(1, 0, 'item', 'yellow'), f(0, 1, 'explore', 'green', 'W'), f(3, 2, 'explore', 'red', 'E'), f(0, 3, 'teleport', 'blue')], stairs: [] },
  { id: 7, rows: ['##.#', '....', '###.', '#.#.'], walls: [], features: [f(2, 0, 'item', 'red'), f(0, 1, 'teleport', 'green'), f(3, 2, 'explore', 'blue', 'E'), f(3, 3, 'teleport', 'yellow')], stairs: [[[1, 3], [2, 1]]] },
  { id: 8, rows: ['....', '.#..', '###.', '....'], walls: [[[2, 1], [3, 1]]], features: [f(0, 1, 'explore', 'red', 'W'), f(2, 1, 'teleport', 'yellow'), f(3, 2, 'explore', 'blue', 'E'), f(0, 3, 'item', 'green')], stairs: [] },
  { id: 9, rows: ['....', '.#..', '..#.', '#.#.'], walls: [[[2, 0], [2, 1]]], features: [f(2, 1, 'teleport', 'red'), f(3, 2, 'explore', 'yellow', 'E'), f(3, 3, 'item', 'blue')], stairs: [] },
];
type PlacedTile = { id: number; x: number; y: number; rotation: number };
type Cell = { x: number; y: number; tile: number; open: string[]; feature?: Omit<Feature, 'at'> };
export interface MagicMazeState {
  gameId: 'magic-maze'; scenarioId: 'pnp-2017-discovery'; players: string[];
  phase: 'briefing' | 'playing' | 'discussing' | 'finished'; ready: Record<string, boolean>;
  tiles: PlacedTile[]; deck: number[];
  heroes: Record<string, Point | null>; permissions: Record<string, string[]>;
  soloDeck: string[]; soloDiscard: string[]; stolen: boolean;
  usedTimers: string[]; remainingMs: number; elapsedMs: number;
  signalTarget: string | null; messages: { playerId: string; text: string }[];
  events: Record<string, unknown>[]; result: Outcome | null; rng: ReturnType<typeof makeRng>;
}
const key = (p: Point) => `${p[0]},${p[1]}`;
const eq = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const rotate = (p: Point, amount: number): Point => { let [x, y] = p; for (let i = 0; i < amount; i++) [x, y] = [3 - y, x]; return [x, y]; };
const direction = (dir: string, amount: number) => DIRS[(DIRS.indexOf(dir) + amount) % 4];
const world = (p: Point, t: PlacedTile): Point => { const r = rotate(p, t.rotation); return [r[0] + t.x, r[1] + t.y]; };
const opposite = (dir: string) => direction(dir, 2);
function board(s: MagicMazeState): Record<string, Cell> {
  const cells: Record<string, Cell> = {};
  for (const t of s.tiles) {
    const def = MAGIC_MAZE_TILES[t.id - 1];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      if (def.rows[y][x] === '#') continue;
      const local: Point = [x, y], p = world(local, t), open: string[] = [];
      for (const dir of DIRS) {
        const d = DELTA[dir], to: Point = [x + d[0], y + d[1]];
        const wall = def.walls.some(([a, b]) => eq(a, local) && eq(b, to) || eq(a, to) && eq(b, local));
        if (!wall && to[0] >= 0 && to[0] < 4 && to[1] >= 0 && to[1] < 4 && def.rows[to[1]][to[0]] !== '#') open.push(direction(dir, t.rotation));
      }
      const feature = def.features.find(f => eq(f.at, local));
      if (feature?.kind === 'explore') open.push(direction(feature.dir!, t.rotation));
      if (t.id !== 1 && x === 1 && y === 3) open.push(direction('S', t.rotation));
      cells[key(p)] = { x: p[0], y: p[1], tile: t.id, open, ...(feature ? { feature: { kind: feature.kind, ...(feature.color ? { color: feature.color } : {}), ...(feature.dir ? { dir: direction(feature.dir, t.rotation) } : {}) } } : {}) };
    }
  }
  return cells;
}
function stairs(s: MagicMazeState): [Point, Point][] {
  return s.tiles.flatMap(t => MAGIC_MAZE_TILES[t.id - 1].stairs.map(([a, b]) => [world(a, t), world(b, t)] as [Point, Point]));
}
function owns(s: MagicMazeState, playerId: string, action: string): boolean {
  if (s.players.length === 1) return s.soloDiscard.at(-1) === action;
  return s.permissions[playerId].includes(action);
}
function validatePlayer(s: MagicMazeState, playerId: string): void { check(s.players.includes(playerId), 'Unknown player.', 'UNKNOWN_PLAYER'); }
function occupied(s: MagicMazeState, p: Point): boolean { return Object.values(s.heroes).some(loc => loc !== null && eq(loc, p)); }
function fail(s: MagicMazeState, reason: string): void { s.phase = 'finished'; s.result = { success: false, score: 0, maxScore: 1, reason }; }
function endIfEscaped(s: MagicMazeState): void {
  if (Object.values(s.heroes).every(p => p === null)) { s.phase = 'finished'; s.result = { success: true, score: 1, maxScore: 1, reason: 'all_heroes_escaped_with_items' }; }
}
function enter(s: MagicMazeState, hero: string, point: Point): void {
  s.heroes[hero] = point;
  const cell = board(s)[key(point)];
  if (cell.feature?.kind === 'timer' && !s.usedTimers.includes(key(point))) {
    s.usedTimers.push(key(point)); s.remainingMs = DURATION - s.remainingMs;
    s.phase = 'discussing'; s.events.push({ type: 'sand_timer_flipped', at: point });
    if (s.players.length === 1) { s.soloDeck = shuffle([...s.soloDeck, ...s.soloDiscard], s.rng); s.soloDiscard = []; }
    if (s.remainingMs <= 0) fail(s, 'sand_timer_expired');
  }
  if (s.phase === 'finished') return;
  if (!s.stolen && COLORS.every(color => {
    const p = s.heroes[color], feature = p && board(s)[key(p)]?.feature;
    return feature && feature.kind === 'item' && feature.color === color;
  })) {
    s.stolen = true; s.events.push({ type: 'items_stolen' });
  }
  // In this preview the exit is used in the escape phase; the preview has no
  // retail-edition immediate-loss rule for visiting it before the theft.
  if (cell.feature?.kind === 'exit' && s.stolen) { s.heroes[hero] = null; endIfEscaped(s); }
}
function matchingExplorers(s: MagicMazeState): string[] {
  const cells = board(s);
  return COLORS.filter(hero => {
    const p = s.heroes[hero]; if (!p) return false;
    const c = cells[key(p)], f = c.feature; if (f?.kind !== 'explore' || f.color !== hero) return false;
    const [dx, dy] = DELTA[f.dir!], adjacent: Point = [p[0] + dx, p[1] + dy];
    // A wall on an already placed tile is not an unexplored region.
    return !s.tiles.some(t => adjacent[0] >= t.x && adjacent[0] < t.x + 4 && adjacent[1] >= t.y && adjacent[1] < t.y + 4);
  });
}
function placement(s: MagicMazeState, hero: string, tileId: number): PlacedTile {
  const p = s.heroes[hero]!, dir = board(s)[key(p)].feature!.dir!;
  const rotation = (DIRS.indexOf(opposite(dir)) - DIRS.indexOf('S') + 4) % 4;
  const entrance = rotate([1, 3], rotation), delta = DELTA[dir];
  return { id: tileId, x: p[0] + delta[0] - entrance[0], y: p[1] + delta[1] - entrance[1], rotation };
}
function canPlace(s: MagicMazeState, hero: string): boolean {
  if (!s.deck.length || !matchingExplorers(s).includes(hero)) return false;
  // Every demo tile has the same bounding box and entrance; this validity
  // check therefore does not disclose the still-hidden top tile.
  const next = placement(s, hero, 0);
  return s.tiles.every(t => next.x + 4 <= t.x || t.x + 4 <= next.x || next.y + 4 <= t.y || t.y + 4 <= next.y);
}
function path(s: MagicMazeState, hero: string, dir: string, distance: number): Point[] | null {
  let p = s.heroes[hero]; if (!p) return null;
  const cells = board(s), result: Point[] = [], d = DELTA[dir];
  for (let n = 0; n < distance; n++) {
    const next: Point = [p[0] + d[0], p[1] + d[1]], a = cells[key(p)], b = cells[key(next)];
    if (!a?.open.includes(dir) || !b?.open.includes(opposite(dir)) || occupied(s, next)) return null;
    result.push(next); p = next;
    if (b.feature?.kind === 'exit' && n < distance - 1) return null;
  }
  return result;
}
function roleCards(count: number): string[][] {
  if (count === 1) return [[]];
  if (count === 2) return [['N', 'E', 'teleport'], ['S', 'W', 'explore', 'escalator']];
  if (count === 3) return [['E', 'N'], ['S', 'explore', 'escalator'], ['W', 'teleport']];
  const cards = [['W', 'teleport'], ['E', 'escalator'], ['S', 'explore'], ['N']];
  if (count >= 5) cards.push(['N']); if (count >= 6) cards.push(['W']); if (count >= 7) cards.push(['S']); if (count >= 8) cards.push(['E']);
  return cards;
}
function simple(type: string, description: string, examples: Action[], properties: Record<string, unknown> = {}): LegalAction {
  return legal(type, description, properties, Object.keys(properties), examples);
}

export const magicMaze: GameAdapter<MagicMazeState> = {
  metadata: {
    id: 'magic-maze', name: 'Magic Maze — publisher Print & Play demo', players: [1, 2, 3, 4, 5, 6, 7, 8],
    sources: [{ title: 'Publisher-authored 2017 preview Print & Play (Ludovox-hosted PDF)', url: SOURCE, kind: 'official-rulebook', verifiedAt: '2026-09-16' }],
    scenarios: [{ id: 'pnp-2017-discovery', name: '2017 preview Print & Play discovery scenario', provenance: 'official-mission', sourceUrl: SOURCE, description: 'All nine included demo maps and 1–8-player action cards; explicitly the publisher work-in-progress preview, not retail Scenario 1.' }],
    rulesSummary: ['Act in real time, without turns. Each player controls only their assigned directions/actions but may operate any hero.', 'Discuss freely before starting. After starting, use the Do Something signal; speech resumes only after a sand-timer flip, while time continues to pass. The next game action ends that discussion window.', 'Move without crossing walls or heroes; explore from a matching coloured port; use escalators or teleport to a same-colour teleporter before theft.', 'Place all four heroes on their respective items, automatically trigger theft, then escape through the one common exit. Teleportation stops after theft.', 'The three-minute sand timer flips at unused timer squares: new time equals 180000 minus current remaining milliseconds, not a reset to three minutes.'],
    implementation: { fidelity: 'official-scenario', implemented: ['all 9 publisher PnP tiles', 'all 1–8-player action cards', 'real-time system clock input', 'sand-timer inversion', 'discussion windows', 'action permission partition', 'exploration and rotation', 'walls and collisions', 'teleportation and escalators', 'theft and shared exit', 'solo action deck'], omitted: ['retail 24-tile edition', 'retail scenarios 2–17', 'optional later-scenario role passing', 'expansions'], verifier: 'exact', notes: ['The public PnP is a publisher-authored work-in-progress preview with red/yellow/green/blue heroes; it is not the final retail map.', 'Only the trusted server/runner may call advanceTime. Zero-time local simulations are not comparable with official real-time play.', 'Free-text speech is restricted by phase. Physical staring is represented by the public Do Something target; physical hand speed is not simulated.', 'Publisher permits trying the paper demo; that is not an open software/artwork/ML-corpus license. Numeric topology only is encoded; no artwork is served.'] }
  },
  setup(options) {
    check(integer(options.playerCount, 1, 8), 'The PnP supports 1–8 players.', 'INVALID_SETUP');
    check(options.scenarioId === 'pnp-2017-discovery', 'Only the explicitly versioned PnP demo is implemented.', 'INVALID_SETUP');
    exactKeys(options.config ?? {}, []);
    const rng = makeRng(options.seed), ids = players(options.playerCount), heroOrder = shuffle(COLORS, rng);
    const starts: Point[] = [[1, 1], [2, 1], [1, 2], [2, 2]], cards = shuffle(roleCards(options.playerCount), rng);
    return { gameId: 'magic-maze', scenarioId: 'pnp-2017-discovery', players: ids, phase: 'briefing', ready: Object.fromEntries(ids.map(id => [id, false])), tiles: [{ id: 1, x: 0, y: 0, rotation: 0 }], deck: shuffle([2, 3, 4, 5, 6, 7, 8, 9], rng), heroes: Object.fromEntries(heroOrder.map((color, index) => [color, starts[index]])), permissions: Object.fromEntries(ids.map((id, index) => [id, cards[index]])), soloDeck: options.playerCount === 1 ? shuffle([...DIRS, 'teleport', 'escalator', 'explore'], rng) : [], soloDiscard: [], stolen: false, usedTimers: [], remainingMs: DURATION, elapsedMs: 0, signalTarget: null, messages: [], events: [], result: null, rng };
  },
  observe(s, playerId) {
    validatePlayer(s, playerId);
    return clone({ gameId: s.gameId, scenarioId: s.scenarioId, playerId, players: s.players, phase: s.phase, ready: s.ready, tiles: s.tiles, board: board(s), escalators: stairs(s), tilesRemaining: s.deck.length, heroes: s.heroes, permissions: s.permissions, soloAction: s.soloDiscard.at(-1) ?? null, soloDeckCount: s.soloDeck.length, stolen: s.stolen, usedTimers: s.usedTimers, remainingMs: s.remainingMs, elapsedMs: s.elapsedMs, signalTarget: s.signalTarget, messages: s.messages, events: s.events, outcome: s.result, communication: { canSendMessage: ['briefing', 'discussing'].includes(s.phase), clockContinuesDuringDiscussion: s.phase === 'discussing' } });
  },
  decisionContext(s, playerId) { const observation = this.observe(s, playerId); delete observation.remainingMs; delete observation.elapsedMs; return observation; },
  activePlayers: s => s.phase === 'finished' ? [] : [...s.players],
  decisionWindow(s) { return s.phase==='briefing'?{key:'briefing',players:s.players.filter(p=>!s.ready[p]),mode:'all'}:null; },
  legalActions(s, playerId) {
    validatePlayer(s, playerId); if (s.phase === 'finished') return [];
    const result: LegalAction[] = [];
    if (['briefing', 'discussing'].includes(s.phase)) result.push(simple('message', 'Speak publicly; during a timer discussion the sand keeps flowing.', [{ type: 'message', text: 'Let us coordinate the next moves.' }], { text: { type: 'string', minLength: 1, maxLength: 2000 } }));
    if (s.phase === 'briefing') {
      if (!s.ready[playerId]) result.push(simple('ready', 'Finish setup discussion; all ready starts the real-time clock.', [{ type: 'ready' }]));
      return result;
    }
    const movement: Action[] = [], teleports: Action[] = [], escalators: Action[] = [];
    const cells = board(s);
    for (const hero of COLORS) {
      if (s.heroes[hero] === null) continue;
      for (const dir of DIRS) if (owns(s, playerId, dir)) for (let distance = 1; distance <= 36; distance++) {
        if (!path(s, hero, dir, distance)) break; movement.push({ type: 'move', hero, direction: dir, distance });
      }
      if (!s.stolen && owns(s, playerId, 'teleport')) for (const c of Object.values(cells)) if (c.feature?.kind === 'teleport' && c.feature.color === hero && !occupied(s, [c.x, c.y])) teleports.push({ type: 'teleport', hero, x: c.x, y: c.y });
      if (owns(s, playerId, 'escalator')) for (const [a, b] of stairs(s)) {
        if (eq(s.heroes[hero]!, a) && !occupied(s, b) || eq(s.heroes[hero]!, b) && !occupied(s, a)) escalators.push({ type: 'escalator', hero });
      }
    }
    if (movement.length) result.push(simple('move', 'Move in a direction on your action card; no wall or pawn may be crossed.', movement, { hero: { enum: COLORS }, direction: { enum: DIRS }, distance: { type: 'integer', minimum: 1, maximum: 36 } }));
    if (teleports.length) result.push(simple('teleport', 'Move from anywhere to a free same-colour teleporter before theft.', teleports, { hero: { enum: COLORS }, x: { type: 'integer' }, y: { type: 'integer' } }));
    if (escalators.length) result.push(simple('escalator', 'Travel between either endpoint of an escalator.', escalators, { hero: { enum: COLORS } }));
    if (owns(s, playerId, 'explore')) {
      const choices = matchingExplorers(s).filter(hero => canPlace(s, hero)).map(hero => ({ type: 'explore', hero }));
      if (choices.length) result.push(simple('explore', 'Reveal and connect the top tile to this matching exploration port.', choices, { hero: { enum: COLORS } }));
    }
    if (s.players.length === 1) result.push(simple('reveal_action', 'Reveal the next solo action card; only the current top action may be used.', [{ type: 'reveal_action' }]));
    else result.push(simple('signal', 'Put the Do Something token before a teammate; no extra message is allowed.', s.players.filter(id => id !== playerId).map(target => ({ type: 'signal', target })), { target: { enum: s.players.filter(id => id !== playerId) } }));
    return result;
  },
  step(state, playerId, action) {
    validatePlayer(state, playerId); check(state.phase !== 'finished', 'The heist is finished.');
    const s = clone(state);
    if (action.type === 'message') {
      actionKeys(action, 'message', ['text']); check(['briefing', 'discussing'].includes(s.phase), 'Speech is forbidden during silent play.');
      check(textValue(action.text, 2000), 'A message needs 1–2000 characters.'); s.messages.push({ playerId, text: action.text });
      if (s.phase === 'briefing') s.ready[playerId] = false;
      return s;
    }
    if (action.type === 'ready') {
      actionKeys(action, 'ready'); check(s.phase === 'briefing' && !s.ready[playerId], 'Already ready or play already started.');
      s.ready[playerId] = true; if (s.players.every(id => s.ready[id])) { s.phase = 'playing'; s.events.push({ type: 'heist_started' }); } return s;
    }
    check(s.phase !== 'briefing', 'All players must finish setup first.');
    const offered = this.legalActions(s, playerId).flatMap(item => item.examples ?? []);
    // Validate the complete object, not only its type; extra fields cannot become a signalling channel.
    check(offered.some(example => JSON.stringify(Object.entries(example).sort()) === JSON.stringify(Object.entries(action).sort())), 'Action violates your card permissions, board geometry, or current phase.');
    if (action.type !== 'signal') s.phase = 'playing';
    const hero = action.hero as string;
    if (action.type === 'move') {
      const route = path(s, hero, action.direction as string, action.distance as number)!;
      for (const p of route) { enter(s, hero, p); if (s.phase === 'finished' || s.heroes[hero] === null) break; }
    } else if (action.type === 'teleport') enter(s, hero, [action.x as number, action.y as number]);
    else if (action.type === 'escalator') {
      const origin = s.heroes[hero]!; const link = stairs(s).find(([a, b]) => eq(a, origin) || eq(b, origin))!;
      enter(s, hero, eq(link[0], origin) ? link[1] : link[0]);
    } else if (action.type === 'explore') s.tiles.push(placement(s, hero, s.deck.shift()!));
    else if (action.type === 'signal') s.signalTarget = action.target as string;
    else if (action.type === 'reveal_action') {
      if (!s.soloDeck.length) { s.soloDeck = [...s.soloDiscard]; s.soloDiscard = []; }
      s.soloDiscard.push(s.soloDeck.shift()!);
    }
    s.events.push({ playerId, ...action }); return s;
  },
  advanceTime(state, elapsedMs) {
    check(Number.isSafeInteger(elapsedMs) && elapsedMs >= 0, 'Invalid trusted time delta.', 'INVALID_TIME');
    const s = clone(state);
    if (!['playing', 'discussing'].includes(s.phase)) return s;
    s.elapsedMs += elapsedMs; s.remainingMs = Math.max(0, s.remainingMs - elapsedMs);
    if (s.remainingMs === 0) fail(s, 'sand_timer_expired'); return s;
  },
  outcome: s => s.result ? clone(s.result) : null,
};
