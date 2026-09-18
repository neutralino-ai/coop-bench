import { test } from 'node:test';
import assert from 'node:assert/strict';
import { magicMaze as game, MAGIC_MAZE_TILES, type MagicMazeState } from '../src/games/magic-maze.ts';
import type { Action } from '../src/types.ts';

const setup = (n = 4, seed = 'magic-maze-tests') => game.setup({ playerCount: n, seed, scenarioId: 'pnp-2017-discovery' });
function started(n = 4, seed?: string): MagicMazeState {
  let s = setup(n, seed); for (const id of s.players) s = game.step(s, id, { type: 'ready' }); return s;
}
function fixture(tile = 1): MagicMazeState {
  const s = started(); s.tiles = [{ id: tile, x: 0, y: 0, rotation: 0 }];
  s.permissions.p1 = ['N', 'E', 'S', 'W', 'teleport', 'escalator', 'explore'];
  s.heroes = { red: [1, 1], yellow: null, green: null, blue: null };
  s.remainingMs = 120000; return s;
}
const action = (s: MagicMazeState, a: Action) => game.step(s, 'p1', a);
const move = (s: MagicMazeState, hero: string, direction: string, distance = 1) => action(s, { type: 'move', hero, direction, distance });
const examples = (s: MagicMazeState, id = 'p1') => game.legalActions(s, id).flatMap(a => a.examples ?? []);

test('PnP component census, connectivity and all player-count action cards', () => {
  assert.equal(MAGIC_MAZE_TILES.length, 9);
  const fs = MAGIC_MAZE_TILES.flatMap(t => t.features);
  assert.equal(fs.filter(f => f.kind === 'timer').length, 4);
  assert.equal(fs.filter(f => f.kind === 'item').length, 4);
  assert.equal(fs.filter(f => f.kind === 'exit').length, 1);
  assert.equal(fs.filter(f => f.kind === 'teleport').length, 16);
  assert.equal(MAGIC_MAZE_TILES.flatMap(t => t.stairs).length, 3);
  assert.deepEqual(MAGIC_MAZE_TILES.map(t => t.rows.join('').replaceAll('#', '').length), [15, 9, 13, 9, 14, 9, 8, 12, 12]);
  for (let n = 2; n <= 8; n++) {
    const s = setup(n), permissions = Object.values(s.permissions).flat();
    assert.deepEqual([...new Set(permissions)].sort(), ['E', 'N', 'S', 'W', 'escalator', 'explore', 'teleport']);
    assert.equal(permissions.filter(p => p === 'explore').length, 1);
    assert.equal(permissions.filter(p => p === 'teleport').length, 1);
    assert.equal(permissions.filter(p => p === 'escalator').length, 1);
  }
  for (const def of MAGIC_MAZE_TILES) {
    const s = fixture(def.id), obs = game.observe(s, 'p1'), cells = obs.board;
    const reached = new Set<string>(), todo = [Object.keys(cells)[0]];
    while (todo.length) {
      const k = todo.pop()!; if (reached.has(k)) continue; reached.add(k);
      const c = cells[k];
      for (const [d, dx, dy] of [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]] as [string, number, number][]) {
        const next = `${c.x + dx},${c.y + dy}`; if (c.open.includes(d) && cells[next]) todo.push(next);
      }
      for (const [a, b] of obs.escalators) { if (a.join(',') === k) todo.push(b.join(',')); if (b.join(',') === k) todo.push(a.join(',')); }
    }
    assert.equal(reached.size, Object.keys(cells).length, `tile ${def.id} connected with escalators`);
  }
});

test('setup is deterministic, version-specific and hidden deck does not affect observation/actions', () => {
  const s = setup(); assert.deepEqual(s, setup());
  assert.throws(() => game.setup({ playerCount: 4, seed: 'x', scenarioId: 'retail' }));
  assert.throws(() => game.setup({ playerCount: 9, seed: 'x', scenarioId: 'pnp-2017-discovery' }));
  const other = structuredClone(s); other.deck.reverse(); other.rng = setup(4, 'other-seed').rng;
  assert.deepEqual(game.observe(s, 'p1'), game.observe(other, 'p1'));
  assert.deepEqual(game.legalActions(s, 'p1'), game.legalActions(other, 'p1'));
  const obs = game.observe(s, 'p1'); assert.equal('deck' in obs, false); assert.equal('rng' in obs, false);
  obs.heroes.red = [999, 999]; assert.notDeepEqual(s.heroes.red, [999, 999]);
});

test('briefing allows unlimited discussion; clock starts only on final ready', () => {
  let s = setup(); const initial = structuredClone(s);
  s = game.step(s, 'p1', { type: 'message', text: 'Watch the exploration colours.' });
  assert.deepEqual(game.advanceTime!(s, 999999), s);
  for (const id of s.players.slice(0, -1)) s = game.step(s, id, { type: 'ready' });
  assert.equal(s.phase, 'briefing'); s = game.step(s, 'p4', { type: 'ready' }); assert.equal(s.phase, 'playing');
  assert.throws(() => game.step(s, 'p1', { type: 'message', text: 'Not allowed.' }));
  assert.deepEqual(setup(), initial);
});

test('everyone may act immediately but only using their own public action card', () => {
  const s = started(); assert.deepEqual(game.activePlayers(s), s.players);
  for (const id of s.players) for (const example of examples(s, id).filter(a => a.type === 'move')) {
    assert.ok(s.permissions[id].includes(example.direction as string));
    const before = structuredClone(s); game.step(s, id, example); assert.deepEqual(s, before);
    const nonOwner = s.players.find(p => !s.permissions[p].includes(example.direction as string))!;
    assert.throws(() => game.step(s, nonOwner, example));
  }
  assert.throws(() => game.step(s, 'p1', { type: 'signal', target: 'p2', hint: 'north' }));
  assert.throws(() => game.step(s, 'outsider', { type: 'signal', target: 'p1' }));
});

test('walls, other pawns and empty outer space block straight moves; no implicit undo', () => {
  let s = fixture(); s.heroes.red = [0, 1]; const copy = structuredClone(s);
  assert.throws(() => move(s, 'red', 'N')); assert.throws(() => move(s, 'red', 'S')); assert.throws(() => move(s, 'red', 'W'));
  s.heroes.yellow = [2, 1]; assert.throws(() => move(s, 'red', 'E', 3));
  assert.deepEqual(move(s, 'red', 'E').heroes.red, [1, 1]);
  s = fixture(5); s.heroes.red = [0, 1];
  assert.throws(() => move(s, 'red', 'E')); assert.throws(() => move(s, 'red', 'S'));
  assert.deepEqual(copy.heroes.red, [0, 1]);
});

test('exploration uses matching colours and joins the white entrance with all four rotations', () => {
  for (const [hero, p, dir, destination, rotation] of [
    ['red', [2, 0], 'N', [2, -1], 0], ['green', [3, 2], 'E', [4, 2], 1],
    ['yellow', [1, 3], 'S', [1, 4], 2], ['blue', [0, 1], 'W', [-1, 1], 3],
  ] as [string, [number, number], string, [number, number], number][]) {
    let s = fixture(); s.heroes = { red: null, green: null, yellow: null, blue: null }; s.heroes[hero] = p; s.deck = [7, 2];
    const before = structuredClone(s); s = action(s, { type: 'explore', hero });
    assert.deepEqual(before.deck, [7, 2]); assert.equal(s.tiles.at(-1)!.rotation, rotation); assert.deepEqual(s.deck, [2]);
    assert.deepEqual(move(s, hero, dir).heroes[hero], destination);
    assert.throws(() => action(s, { type: 'explore', hero }));
  }
  const wrong = fixture(); wrong.heroes.red = [0, 1]; assert.throws(() => action(wrong, { type: 'explore', hero: 'red' }));
});

test('all revealed passages admit any hero and hidden tile permutation cannot change legal exploration', () => {
  let s = fixture(); s.heroes.red = [2, 0]; s.heroes.blue = [2, 1];
  const other = structuredClone(s); other.deck.reverse();
  assert.deepEqual(game.legalActions(s, 'p1'), game.legalActions(other, 'p1'));
  s = action(s, { type: 'explore', hero: 'red' }); s = move(s, 'red', 'W');
  s = move(s, 'blue', 'N', 2); assert.deepEqual(s.heroes.blue, [2, -1]);
});

test('teleport uses only matching free destinations and ends permanently after theft', () => {
  let s = fixture(); s = action(s, { type: 'teleport', hero: 'red', x: 0, y: 2 }); assert.deepEqual(s.heroes.red, [0, 2]);
  assert.throws(() => action(s, { type: 'teleport', hero: 'red', x: 3, y: 0 }));
  s.heroes.yellow = [0, 2]; s.heroes.red = [1, 1]; assert.throws(() => action(s, { type: 'teleport', hero: 'red', x: 0, y: 2 }));
  s.heroes.yellow = null; s.stolen = true; assert.equal(examples(s).some(a => a.type === 'teleport'), false);
});

test('escalators cross blocked cells in either direction but cannot land on a pawn', () => {
  let s = fixture(7); s.heroes.red = [1, 3];
  s = action(s, { type: 'escalator', hero: 'red' }); assert.deepEqual(s.heroes.red, [2, 1]);
  s.heroes.yellow = [1, 3]; assert.throws(() => action(s, { type: 'escalator', hero: 'red' }));
  s.heroes.yellow = null; s = action(s, { type: 'escalator', hero: 'red' }); assert.deepEqual(s.heroes.red, [1, 3]);
});

test('sand timer inversion may lose time, each square is once-only, and discussion continues ticking', () => {
  let s = fixture(); s.heroes.red = [1, 0]; s = move(s, 'red', 'W');
  assert.equal(s.remainingMs, 60000); assert.equal(s.phase, 'discussing'); assert.deepEqual(s.usedTimers, ['0,0']);
  s = action(s, { type: 'message', text: 'We used this hourglass early.' });
  s = game.advanceTime!(s, 5000); assert.equal(s.remainingMs, 55000); assert.equal(s.phase, 'discussing');
  s = move(s, 'red', 'E'); assert.equal(s.phase, 'playing'); s = move(s, 'red', 'W');
  assert.equal(s.remainingMs, 55000); assert.equal(s.phase, 'playing');
  assert.throws(() => action(s, { type: 'message', text: 'Still silent.' }));
  s = fixture(3); s.heroes.red = [1, 2]; s.remainingMs = 40000;
  s = move(s, 'red', 'W'); assert.equal(s.remainingMs, 140000);
});

test('each of the four printed hourglass dead ends triggers on its valid approach', () => {
  for (const [tile, origin, dir] of [[1, [1, 0], 'W'], [3, [1, 2], 'W'], [4, [1, 2], 'N'], [5, [2, 2], 'N']] as [number, [number, number], string][]) {
    let s = fixture(tile); s.heroes.red = origin; s.remainingMs = 30000;
    s = move(s, 'red', dir); assert.equal(s.remainingMs, 150000); assert.equal(s.phase, 'discussing');
  }
});

test('trusted clock rejects invalid time, timeout is terminal and stable decision context omits only ticking time', () => {
  let s = started(); const before = structuredClone(s), context = game.decisionContext!(s, 'p1');
  s = game.advanceTime!(s, 111); assert.equal(s.remainingMs, 179889); assert.deepEqual(game.decisionContext!(s, 'p1'), context);
  assert.deepEqual(game.legalActions(s, 'p1'), game.legalActions(before, 'p1'));
  for (const value of [-1, 0.1, Infinity, NaN]) assert.throws(() => game.advanceTime!(s, value));
  s = game.advanceTime!(s, 179889); assert.equal(game.outcome(s)!.success, false); assert.equal(s.phase, 'finished');
  assert.notDeepEqual(game.decisionContext!(s, 'p1'), context); assert.deepEqual(game.activePlayers(s), []);
  assert.throws(() => action(s, { type: 'signal', target: 'p2' }));
  assert.deepEqual(game.advanceTime!(s, 999), s);
});

test('zero sand after an early flip loses immediately, not a free reset', () => {
  const s = fixture(); s.heroes.red = [1, 0]; s.remainingMs = 180000;
  const next = move(s, 'red', 'W'); assert.equal(game.outcome(next)!.reason, 'sand_timer_expired');
});

test('all four simultaneous item occupancies trigger theft automatically; partial occupation does not', () => {
  let s = fixture(); s.tiles = [6, 7, 8, 9].map((id, index) => ({ id, x: index * 4, y: 0, rotation: 0 }));
  s.heroes = { yellow: [1, 0], red: [6, 0], green: [8, 3], blue: [15, 2] };
  assert.equal(s.stolen, false); assert.equal(examples(s).some(a => a.type === 'steal'), false);
  s = move(s, 'blue', 'S'); assert.equal(s.stolen, true);
  assert.ok(s.events.some(e => e.type === 'items_stolen'));
  assert.equal(examples(s).some(a => a.type === 'teleport'), false);
});

test('shared exit removes escaped heroes and exact final hero gives victory', () => {
  let s = fixture(2); s.heroes.red = [3, 0];
  s = move(s, 'red', 'S'); assert.equal(s.phase, 'playing'); assert.deepEqual(s.heroes.red, [3, 1]);
  s = move(s, 'red', 'N'); s.stolen = true;
  s = move(s, 'red', 'S'); assert.equal(s.heroes.red, null); assert.equal(game.outcome(s)!.success, true);
});

test('solo exposes only current action, recycles without shuffle and reshuffles on hourglass flip', () => {
  let s = started(1), original = [...s.soloDeck];
  const other = structuredClone(s); other.soloDeck.reverse(); assert.deepEqual(game.observe(s, 'p1'), game.observe(other, 'p1'));
  assert.equal(examples(s).some(a => a.type === 'move'), false);
  for (const expected of original) { s = action(s, { type: 'reveal_action' }); assert.equal(game.observe(s, 'p1').soloAction, expected); }
  s = action(s, { type: 'reveal_action' }); assert.equal(game.observe(s, 'p1').soloAction, original[0]);
  s.soloDiscard = ['W']; s.soloDeck = ['N', 'E', 'S', 'teleport', 'escalator', 'explore'];
  s.heroes = { red: [1, 0], green: null, yellow: null, blue: null }; s.remainingMs = 10000;
  s = move(s, 'red', 'W'); assert.equal(s.soloDiscard.length, 0); assert.equal(s.soloDeck.length, 7);
  assert.equal(game.observe(s, 'p1').soloAction, null);
});

test('legal-action samples run across seeds and player counts with a trusted clock until terminal', () => {
  for (let n = 1; n <= 8; n++) {
    let s = started(n, `smoke-${n}`), steps = 0;
    while (!game.outcome(s) && steps < 200) {
      const id = s.players[steps % n], choices = examples(s, id).filter(a => !['signal', 'message'].includes(a.type));
      if (choices.length) s = game.step(s, id, choices[steps % choices.length]);
      s = game.advanceTime!(s, 10000); steps++;
    }
    assert.ok(game.outcome(s), `player count ${n} terminates with real time`);
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  }
});

test('three-player public-map rule oracle explores all nine tiles, steals and escapes through real steps', t => {
  // This is an omnicoordinated mechanical reachability oracle, not three
  // independent agents or a benchmark of real-time play. Planning sees only
  // observe(); the runner injects 1 ms per action. No game state is rewritten.
  const seed = 'magic-maze-complete-rule-oracle-v1';
  let s = setup(3, seed), actions = 0;
  const transcript: { playerId: string; action: Action }[] = [];
  const perform = (playerId: string, a: Action) => {
    assert.ok(examples(s, playerId).some(offered => JSON.stringify(offered) === JSON.stringify(a)), `legal ${JSON.stringify(a)}`);
    s = game.advanceTime!(s, 1);
    s = game.step(s, playerId, a); transcript.push({ playerId, action: a }); actions++;
  };
  for (const id of game.observe(s, 'p1').players) perform(id, { type: 'ready' });
  const colors = ['red', 'yellow', 'green', 'blue'];
  const directions: [string, number, number, string][] = [['N', 0, -1, 'S'], ['E', 1, 0, 'W'], ['S', 0, 1, 'N'], ['W', -1, 0, 'E']];
  type Route = { hero: string; target: string; steps: Action[] };
  function route(hero: string, target: string, obs = game.observe(s, 'p1')): Route | null {
    const cells = obs.board, start = obs.heroes[hero]?.join(',');
    if (!start) return null;
    const blocked = new Set(Object.entries(obs.heroes).filter(([h, p]) => h !== hero && p !== null).map(([, p]) => (p as number[]).join(',')));
    const queue = [start], seen = new Map<string, { from: string; action: Action } | null>([[start, null]]);
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index]; if (current === target) {
        const steps: Action[] = []; let at = current;
        while (seen.get(at)) { const edge = seen.get(at)!; steps.unshift(edge.action); at = edge.from; }
        return { hero, target, steps };
      }
      const c = cells[current], successors: { to: string; action: Action }[] = [];
      for (const [direction, dx, dy, reverse] of directions) {
        const to = `${c.x + dx},${c.y + dy}`;
        if (c.open.includes(direction) && cells[to]?.open.includes(reverse)) successors.push({ to, action: { type: 'move', hero, direction, distance: 1 } });
      }
      for (const [a, b] of obs.escalators) {
        if (a.join(',') === current) successors.push({ to: b.join(','), action: { type: 'escalator', hero } });
        if (b.join(',') === current) successors.push({ to: a.join(','), action: { type: 'escalator', hero } });
      }
      if (!obs.stolen) for (const c of Object.values(cells) as any[]) if (c.feature?.kind === 'teleport' && c.feature.color === hero) successors.push({ to: `${c.x},${c.y}`, action: { type: 'teleport', hero, x: c.x, y: c.y } });
      for (const edge of successors) {
        if (seen.has(edge.to) || blocked.has(edge.to)) continue;
        // All four timer cells in the PnP are dead ends. Avoid spending one
        // merely to reposition. No timer or time-limit state is bypassed.
        if (cells[edge.to].feature?.kind === 'timer' && !obs.usedTimers.includes(edge.to)) continue;
        if (obs.stolen && cells[edge.to].feature?.kind === 'exit' && edge.to !== target) continue;
        seen.set(edge.to, { from: current, action: edge.action }); queue.push(edge.to);
      }
    }
    return null;
  }
  function travel(r: Route) {
    for (const a of r.steps) {
      const permission = a.type === 'move' ? a.direction : a.type;
      const obs = game.observe(s, 'p1'), owner = obs.players.find((id: string) => obs.permissions[id].includes(permission));
      assert.ok(owner, `action ${String(permission)} has an owner`); perform(owner, a);
    }
  }
  const shortest = (routes: (Route | null)[]) => routes.filter((r): r is Route => r !== null).sort((a, b) => a.steps.length - b.steps.length)[0];
  function coordinatedRoute(targets: { hero: string; target: string }[], movable = colors): Route | null {
    // A pawn can plug a one-cell corridor. Search public pawn configurations
    // for short clearing moves before routing the objective pawn. These are
    // hypothetical positions only; the live game changes exclusively in perform.
    const obs = game.observe(s, 'p1'), queue = [{ heroes: obs.heroes, prefix: [] as Action[] }], seen = new Set([JSON.stringify(obs.heroes)]);
    for (let index = 0; index < queue.length && index < 2000; index++) {
      const node = queue[index], view = { ...obs, heroes: node.heroes };
      const goal = shortest(targets.map(target => route(target.hero, target.target, view)));
      if (goal) return { ...goal, steps: [...node.prefix, ...goal.steps] };
      for (const hero of movable) {
        const from = node.heroes[hero]; if (!from) continue;
        const c = obs.board[from.join(',')];
        for (const [direction, dx, dy, reverse] of directions) {
          const point = [c.x + dx, c.y + dy], to = point.join(','), destination = obs.board[to];
          if (!c.open.includes(direction) || !destination?.open.includes(reverse)) continue;
          if (Object.values(node.heroes).some(p => p !== null && (p as number[]).join(',') === to)) continue;
          if (destination.feature?.kind === 'timer' && !obs.usedTimers.includes(to)) continue;
          if (obs.stolen && destination.feature?.kind === 'exit') continue;
          const heroes = { ...node.heroes, [hero]: point }, key = JSON.stringify(heroes); if (seen.has(key)) continue;
          seen.add(key); queue.push({ heroes, prefix: [...node.prefix, { type: 'move', hero, direction, distance: 1 }] });
        }
      }
    }
    return null;
  }
  while (game.observe(s, 'p1').tilesRemaining > 0) {
    const obs = game.observe(s, 'p1');
    const ports = (Object.values(obs.board) as any[]).filter(c => {
      if (c.feature?.kind !== 'explore') return false;
      const [x, y] = c.feature.dir === 'N' ? [c.x - 1, c.y - 4] : c.feature.dir === 'E' ? [c.x + 1, c.y - 1] : c.feature.dir === 'S' ? [c.x - 2, c.y + 1] : [c.x - 4, c.y - 2];
      return obs.tiles.every((tile: any) => x + 4 <= tile.x || tile.x + 4 <= x || y + 4 <= tile.y || tile.y + 4 <= y);
    });
    const next = coordinatedRoute(ports.map(c => ({ hero: c.feature.color, target: `${c.x},${c.y}` })));
    assert.ok(next, `publicly reachable exploration port after ${obs.tiles.length} maps`); travel(next);
    const owner = obs.players.find((id: string) => obs.permissions[id].includes('explore'));
    perform(owner, { type: 'explore', hero: next.hero });
  }
  assert.deepEqual(game.observe(s, 'p1').tiles.map((tile: any) => tile.id).sort((a: number, b: number) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const items = (Object.values(game.observe(s, 'p1').board) as any[]).filter(c => c.feature?.kind === 'item');
  const remaining = new Set(colors);
  while (remaining.size) {
    const next = coordinatedRoute(items.filter(c => remaining.has(c.feature.color)).map(c => ({ hero: c.feature.color, target: `${c.x},${c.y}` })), [...remaining]);
    assert.ok(next, 'an unparked hero can reach its item'); travel(next); remaining.delete(next.hero);
  }
  assert.equal(game.observe(s, 'p1').stolen, true, 'theft is triggered automatically by the final arrival');
  const exit = (Object.values(game.observe(s, 'p1').board) as any[]).find(c => c.feature?.kind === 'exit');
  for (const hero of colors) {
    const next = route(hero, `${exit.x},${exit.y}`); assert.ok(next, `escape path for ${hero}`); travel(next);
    assert.equal(game.observe(s, 'p1').heroes[hero], null);
  }
  assert.equal(game.outcome(s)!.success, true); assert.equal(game.outcome(s)!.reason, 'all_heroes_escaped_with_items');
  assert.equal(transcript.filter(e => e.action.type === 'explore').length, 8);
  assert.deepEqual([...new Set(transcript.filter(e => e.action.type !== 'ready').map(e => e.playerId))].sort(), ['p1', 'p2', 'p3']);
  assert.ok(actions > 50); assert.ok(game.observe(s, 'p1').remainingMs > 0);
  // Replay uses exactly the same seed, submitted actions and trusted 1 ms
  // deltas; it has no fixture jumps, altered map, moved pawn or forced result.
  let replay = setup(3, seed);
  for (const entry of transcript) replay = game.step(game.advanceTime!(replay, 1), entry.playerId, entry.action);
  assert.deepEqual(replay, s);
  t.diagnostic(`rule oracle: seed=${seed}; players=3; actions=${actions}; tiles=9; win=true; injected ms/action=1`);
});
