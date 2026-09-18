// Read-only evidence audit. Does not contact players or inspect provider internals.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseAgentResponse } from './hanabi-demo.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const colors = ['white', 'red', 'blue', 'yellow', 'green'];
const sha = text => createHash('sha256').update(text).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const lines = path => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
function expand(input) {
  const view = structuredClone(input.view);
  if (input.handColumns) {
    assert.equal(input.legend, 'null=未显示；候选颜色以|分隔，候选数字逐位列出；*=全部五色或1至5。无信息删减。');
    assert.deepEqual(input.handColumns, ['index', 'id', 'color', 'value', 'possibleColors', 'possibleValues']);
    view.hands = Object.fromEntries(Object.entries(view.hands).map(([id, hand]) => [id, hand.map(row => {
      assert.equal(row.length, 6);
      const [index, cardId, color, value, cc, vv] = row;
      return { index, id: cardId, possibleColors: cc === '*' ? colors : cc.split('|'),
        possibleValues: vv === '*' ? [1, 2, 3, 4, 5] : [...vv].map(Number),
        ...(color === null ? {} : { color }), ...(value === null ? {} : { value }) };
    })]));
  }
  return view;
}
function hidden(view, player) {
  assert.ok(view && view.hands?.[player], 'Seat view must exist');
  for (const card of view.hands[player]) {
    assert.ok(!Object.hasOwn(card, 'color') && !Object.hasOwn(card, 'value'), 'Own actual card leaked');
  }
  assert.ok(!Object.hasOwn(view, 'seed') && !Object.hasOwn(view, 'deck'), 'Hidden deal leaked');
}
const total = view => Object.values(view.fireworks).reduce((a, b) => a + b, 0);

/** Exact feasible identities using ONLY this actor's visible cards and hints.
 * Does not inspect the saved deal, true own faces, or hint-giver intent.
 */
export function feasibleIdentities(view, player, index) {
  const copies = [0, 3, 2, 2, 2, 1], remaining = new Map();
  for (const color of colors) for (let value = 1; value <= 5; value++) remaining.set(`${color}:${value}`, copies[value]);
  const remove = card => {
    const key = `${card.color}:${card.value}`;
    assert.ok(remaining.has(key) && remaining.get(key) > 0, 'Visible cards violate the deck multiplicities');
    remaining.set(key, remaining.get(key) - 1);
  };
  for (const [color, height] of Object.entries(view.fireworks)) for (let value = 1; value <= height; value++) remove({ color, value });
  for (const card of view.discard) remove(card);
  for (const [seat, hand] of Object.entries(view.hands)) if (seat !== player) for (const card of hand) remove(card);
  const hand = view.hands[player], chosen = hand.find(card => card.index === index);
  assert.ok(chosen);
  assert.equal([...remaining.values()].reduce((a, b) => a + b, 0), hand.length + view.deckCount);
  const fits = (slot, color, value) => slot.possibleColors.includes(color) && slot.possibleValues.includes(value);
  const candidates = [];
  for (const [key, count] of remaining) {
    const [color, rank] = key.split(':'), value = Number(rank);
    if (!count || !fits(chosen, color, value)) continue;
    const pool = [];
    for (const [other, available] of remaining) for (let n = 0; n < available - Number(other === key); n++) {
      const [c, v] = other.split(':'); pool.push({ color: c, value: Number(v) });
    }
    const slots = hand.filter(card => card !== chosen), matched = new Map();
    function augment(slotIndex, seen) {
      for (const [cardIndex, card] of pool.entries()) {
        if (seen.has(cardIndex) || !fits(slots[slotIndex], card.color, card.value)) continue;
        seen.add(cardIndex);
        if (!matched.has(cardIndex) || augment(matched.get(cardIndex), seen)) { matched.set(cardIndex, slotIndex); return true; }
      }
      return false;
    }
    if (slots.every((_, slotIndex) => augment(slotIndex, new Set()))) candidates.push({ color, value });
  }
  assert.ok(candidates.length, 'No hand assignment fits visible information');
  return candidates;
}

export function auditRelay({ rollout, replay, transcripts, inputs, outputs, instructions }) {
  assert.equal(rollout.summary.gameId, 'hanabi');
  assert.equal(rollout.summary.status, 'completed');
  assert.equal(rollout.summary.rejectedCount, 0, 'Rejected attempts require additional manual review');
  assert.equal(replay.valid, true, 'Server replay verification failed');
  const frames = rollout.frames.filter(frame => frame.kind === 'accepted');
  assert.ok(frames.length > 0, 'Completed relay must contain accepted actions');
  assert.equal(frames.length, rollout.summary.actionCount);
  assert.equal(replay.acceptedActions, frames.length, 'Replay action count differs from this rollout');
  assert.match(frames.at(-1).stateHash, /^[a-f0-9]{64}$/, 'Missing final server state hash');
  assert.equal(replay.finalStateHash, frames.at(-1).stateHash, 'Replay final state hash differs from this rollout');
  assert.equal(inputs.length, frames.length, 'Missing/extra turn input');
  assert.equal(outputs.length, frames.length, 'Missing/extra turn output');
  const players = ['p1', 'p2', 'p3'], frameByObservation = new Map();
  assert.deepEqual(Object.keys(transcripts).sort(), players, 'Missing/extra player transcript');
  assert.deepEqual(rollout.players, players, 'This audit requires the three-player relay');
  assert.equal(rollout.summary.playerCount, players.length);
  for (const frame of frames) {
    const observed = frame.observed;
    assert.ok(observed && typeof observed.observationId === 'string', 'Missing bound server observation');
    assert.equal(observed.episodeId, rollout.summary.episodeId);
    assert.equal(observed.playerId, frame.playerId);
    assert.ok(!frameByObservation.has(observed.observationId), 'Duplicate server action observation');
    frameByObservation.set(observed.observationId, frame);
  }
  const byObservation = new Map(), counts = {}, traceOutputs = new Map();
  for (const player of players) {
    const trace = transcripts[player];
    assert.equal(trace[0]?.type, 'session', 'Missing initial session record');
    assert.equal(trace.filter(entry => entry.type === 'session').length, 1, 'Duplicate session record');
    assert.equal(trace[0].playerId, player);
    assert.equal(trace[0].episodeId, rollout.summary.episodeId);
    assert.equal(trace[0].reasoningAvailability, 'not-provided');
    const prompts = trace.filter(entry => entry.type === 'model-input');
    const decisionCount = frames.filter(frame => frame.playerId === player).length;
    assert.equal(prompts.length, decisionCount + 1, 'Missing/extra captured prompts');
    assert.equal(prompts[0].raw.content, instructions);
    assert.equal(prompts[0].raw.role, 'user');
    const replies = trace.filter(entry => entry.type === 'model-output');
    assert.equal(replies.length, decisionCount + 1, 'Missing/extra captured responses');
    assert.equal(replies[0].raw.content, '{"ready":true}');
    assert.equal(replies[0].raw.role, 'assistant');
    assert.equal(prompts.length, replies.length);
    const actionCalls = trace.filter(entry => entry.type === 'tool-call' && entry.raw.method === 'POST');
    assert.equal(actionCalls.length, replies.length - 1);
    for (const entry of prompts.slice(1)) {
      assert.equal(entry.raw.role, 'user');
      assert.ok(entry.raw.content.startsWith('GAME_TURN\n'));
      const input = JSON.parse(entry.raw.content.slice('GAME_TURN\n'.length));
      const expectedKeys = ['availableActionTypes', 'observationId', 'playerId', 'publicEventsSincePreviousTurn', 'view',
        ...(input.handColumns ? ['handColumns', 'legend'] : [])].sort();
      assert.deepEqual(Object.keys(input).sort(), expectedKeys, 'Unexpected extra model input');
      assert.equal(input.playerId, player);
      assert.equal(input.view.current, player);
      assert.ok(!byObservation.has(input.observationId), 'Duplicate captured observation');
      hidden(expand(input), player);
      byObservation.set(input.observationId, { input, entry });
    }
    for (const [index, entry] of replies.slice(1).entries()) {
      assert.equal(entry.raw.role, 'assistant');
      const reply = parseAgentResponse(entry.raw.content), callEntry = actionCalls[index], call = callEntry.raw;
      assert.deepEqual(call.body.action, reply.action, 'Relay changed the action');
      assert.equal(call.body.decisionSummary, reply.decisionSummary, 'Relay changed decision summary');
      assert.deepEqual(Object.keys(call.body).sort(), ['action', 'decisionSummary', 'observationId']);
      assert.ok(byObservation.has(call.body.observationId));
      const capture = byObservation.get(call.body.observationId);
      assert.equal(capture.input.playerId, player);
      assert.equal(capture.entry, prompts[index + 1], 'Action is bound to a different captured turn');
      assert.ok(trace.indexOf(capture.entry) < trace.indexOf(entry) && trace.indexOf(entry) < trace.indexOf(callEntry),
        'Turn must be captured in input, response, action order');
      if (prompts[index + 2]) assert.ok(trace.indexOf(callEntry) < trace.indexOf(prompts[index + 2]), 'Next prompt precedes the previous action');
      assert.ok(entry.at >= capture.entry.at, 'Response predates input capture');
      assert.ok(!traceOutputs.has(call.body.observationId), 'Duplicate response observation');
      traceOutputs.set(call.body.observationId, entry);
    }
    const calls = new Map(), results = new Map();
    for (const entry of trace) {
      if (entry.type === 'tool-call') {
        assert.ok(!calls.has(entry.raw.callId)); calls.set(entry.raw.callId, entry);
        const endpoint = new URL(entry.raw.url);
        assert.equal(endpoint.origin, 'https://coop.neutrinophysics.cn');
        const prefix = `/api/v1/episodes/${rollout.summary.episodeId}`;
        assert.ok(endpoint.pathname === prefix + '/observation' && entry.raw.method === 'GET'
          || endpoint.pathname === prefix + '/actions' && entry.raw.method === 'POST', 'Unexpected tool endpoint');
      } else if (entry.type === 'tool-result') {
        assert.ok(!results.has(entry.raw.callId)); results.set(entry.raw.callId, entry);
        assert.equal(entry.raw.status, 200);
        const obs = entry.raw.body.observation ?? entry.raw.body;
        assert.equal(obs.episodeId, rollout.summary.episodeId, 'Receipt belongs to a different episode');
        assert.equal(obs.playerId, player);
        hidden(obs.view, player);
        for (const update of obs.updates ?? []) hidden(update.view, player);
      } else assert.ok(['session', 'model-input', 'model-output'].includes(entry.type));
    }
    assert.deepEqual([...calls.keys()].sort(), [...results.keys()].sort(), 'Missing tool request or receipt');
    for (const [id, call] of calls) {
      const receipt = results.get(id);
      assert.ok(receipt.at >= call.at);
      assert.ok(trace.indexOf(call) < trace.indexOf(receipt), 'Receipt precedes its request');
      if (call.raw.method === 'POST') {
        assert.equal(receipt.raw.body.accepted, true);
        const frame = frameByObservation.get(call.raw.body.observationId);
        assert.ok(frame && frame.playerId === player, 'Unbound action call requires additional review');
        assert.equal(call.raw.idempotencyKey, frame.requestId, 'Action request ID differs from the server record');
        const observation = receipt.raw.body.observation;
        for (const key of ['episodeId', 'playerId', 'status', 'view', 'legalActions', 'outcome'])
          assert.deepEqual(observation[key], frame.views[player][key], `Action receipt ${key} differs from server projection`);
      } else {
        const observation = receipt.raw.body, frame = frameByObservation.get(observation.observationId);
        assert.ok(frame && frame.playerId === player, 'Unbound observation receipt requires additional review');
        assert.deepEqual(observation, frame.observed, 'Observation receipt differs from bound server observation');
        const capture = byObservation.get(observation.observationId);
        assert.ok(capture && trace.indexOf(receipt) < trace.indexOf(capture.entry), 'Prompt precedes its observation receipt');
      }
    }
    for (const prompt of prompts.slice(1)) {
      const observationId = JSON.parse(prompt.raw.content.slice('GAME_TURN\n'.length)).observationId;
      assert.ok([...calls.values()].some(call => call.raw.method === 'GET'
        && results.get(call.raw.callId).raw.body.observationId === observationId), 'Missing observation receipt for captured prompt');
    }
    counts[player] = { decisions: replies.length - 1, capturedMessages: prompts.length + replies.length,
      toolCalls: trace.filter(entry => entry.type === 'tool-call').length, publicHints: 0, plays: 0, discards: 0 };
  }
  const boundIds = [...frameByObservation.keys()].sort();
  assert.deepEqual([...byObservation.keys()].sort(), boundIds, 'Captured prompts do not exactly cover server actions');
  assert.deepEqual([...traceOutputs.keys()].sort(), boundIds, 'Captured responses do not exactly cover server actions');
  const timeline = [];
  for (const [index, frame] of frames.entries()) {
    const actor = frame.playerId, observed = frame.observed;
    assert.ok(observed && byObservation.has(observed.observationId));
    assert.equal(actor, ['p1', 'p2', 'p3'][index % 3]);
    const { input, entry } = byObservation.get(observed.observationId);
    const replyEntry = traceOutputs.get(observed.observationId);
    assert.ok(replyEntry);
    const reply = parseAgentResponse(replyEntry.raw.content);
    assert.equal(inputs[index].playerId, actor);
    assert.equal(outputs[index].playerId, actor);
    assert.equal(inputs[index].text, entry.raw.content, 'Delivered prompt file differs from captured prompt');
    assert.equal(outputs[index].text, replyEntry.raw.content, 'Original output file differs from captured reply');
    assert.equal(observed.playerId, actor);
    assert.deepEqual(expand(input), observed.view, 'Prompt differs from exact bound server observation');
    assert.deepEqual(input.availableActionTypes, observed.legalActions.map(action => action.type));
    assert.deepEqual(input.publicEventsSincePreviousTurn, (observed.updates ?? []).map(u => u.view.lastEvent).filter(Boolean));
    assert.deepEqual(reply.action, frame.action);
    assert.equal(reply.decisionSummary, frame.decisionSummary);
    assert.ok(!frame.error);
    const before = observed.view, after = frame.views[actor].view, event = after.lastEvent, action = frame.action;
    hidden(before, actor); hidden(after, actor);
    assert.equal(event.type, action.type); assert.equal(event.player, actor);
    if (action.type === 'hint') {
      counts[actor].publicHints++;
      assert.ok(before.hints > 0 && action.target !== actor);
      const touched = before.hands[action.target].filter(card => card[action.kind] === action.value).map(card => card.index);
      assert.deepEqual(event.touched, touched, 'Hint missed or added matching cards');
      assert.equal(after.hints, before.hints - 1);
      assert.equal(after.errors, before.errors); assert.deepEqual(after.fireworks, before.fireworks);
    } else {
      counts[actor][action.type === 'play' ? 'plays' : 'discards']++;
      assert.equal(event.index, action.index);
      if (action.type === 'discard') {
        assert.ok(before.hints < 8);
        assert.equal(after.hints, before.hints + 1); assert.deepEqual(after.fireworks, before.fireworks);
        assert.equal(after.errors, before.errors);
      } else {
        const successful = event.card.value === before.fireworks[event.card.color] + 1;
        assert.equal(event.played, successful);
        assert.equal(after.errors, before.errors + (successful ? 0 : 1));
        assert.deepEqual(after.fireworks, { ...before.fireworks,
          [event.card.color]: before.fireworks[event.card.color] + (successful ? 1 : 0) });
        assert.equal(after.hints, Math.min(8, before.hints + (successful && event.card.value === 5 ? 1 : 0)));
      }
    }
    const candidates = action.type === 'hint' ? undefined : feasibleIdentities(before, actor, action.index);
    if (candidates) assert.ok(candidates.some(card => card.color === event.card.color && card.value === event.card.value), 'Revealed card contradicts legal prior information');
    timeline.push({ turn: index + 1, at: frame.at, playerId: actor, action,
      decisionSummary: frame.decisionSummary, boardScore: total(after), errors: after.errors, hints: after.hints,
      deckCount: after.deckCount, revealed: action.type === 'hint' ? undefined : event.card,
      feasibleIdentitiesFromVisibleInformation: candidates,
      logicallySafePlay: action.type === 'play' ? candidates.every(card => card.value === before.fireworks[card.color] + 1) : undefined,
      promptSha256: sha(entry.raw.content), responseSha256: sha(replyEntry.raw.content) });
  }
  const final = frames.at(-1).views[frames.at(-1).playerId].view;
  assert.ok(final.done);
  const expectedScore = final.errors >= 3 ? 0 : total(final);
  assert.equal(rollout.summary.outcome.score, expectedScore);
  return { schema: 'coop-relay-audit/v1', episodeId: rollout.summary.episodeId, checkedAt: new Date().toISOString(),
    result: 'passed-with-capture-limitations', checks: ['captured turn prompts and responses exactly cover accepted server actions',
      'captured prompts match bound seat observations; own faces and deck/seed are absent',
      'captured prompts contain only the supplied instruction reference and verified turn data',
      'original responses equal submitted actions and private summaries; request IDs and receipts match server records',
      'captured game communication, hint matches, turn order and public score verified',
      'server replay result is bound to this rollout by accepted action count and final state hash'],
    counts, outcome: rollout.summary.outcome, finalFireworks: final.fireworks, finalErrors: final.errors,
    actionCount: frames.length, replayValid: true, timeline,
    limitations: ['This is an audit of relay records, not attestation of the provider runtime.',
      'Internal prompts, hidden reasoning, token IDs/usage and tool use outside this relay were unavailable.',
      'Decision summaries are visible self-reports; plausible reasoning does not prove absence of every covert channel.',
      'Separate fresh contexts were reported by the coordinator; this audit does not attest to process or sandbox isolation.'] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const privateDir = join(root, 'artifacts/cloud-private/hanabi-demo'), publicDir = join(root, 'artifacts/hanabi-demo');
  const files = readdirSync(privateDir), readTurns = kind => files.filter(name => new RegExp(`^turn-\\d{3}-p[123]-${kind}\\.(txt|json)$`).test(name)).sort()
    .map(name => ({ playerId: name.match(/-(p[123])-/)[1], text: readFileSync(join(privateDir, name), 'utf8') }));
  const report = auditRelay({ rollout: json(join(publicDir, 'rollout.json')), replay: json(join(publicDir, 'replay.json')),
    transcripts: Object.fromEntries(['p1', 'p2', 'p3'].map(id => [id, lines(join(privateDir, id, 'transcript.jsonl'))])),
    inputs: readTurns('input'), outputs: readTurns('output'), instructions: readFileSync(join(root, 'docs/hanabi-player-instructions.txt'), 'utf8') });
  writeFileSync(join(publicDir, 'relay-audit.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ result: report.result, actionCount: report.actionCount, counts: report.counts, outcome: report.outcome }));
}
