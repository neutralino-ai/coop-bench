import test from 'node:test';
import assert from 'node:assert/strict';
import { Authority } from '../src/authority.ts';
import { hanabi } from '../src/games/hanabi.ts';
import { auditRelay, feasibleIdentities } from '../scripts/audit-hanabi-relay.mjs';
import { redact } from '../scripts/hanabi-demo.mjs';

// Synthetic, in-memory evidence fixture. It is never uploaded as a model game.
function fixture() {
  const authority = new Authority(':memory:', [hanabi], 'relay-audit-fixture');
  try {
    const session = authority.create('hanabi', { playerCount: 3, scenarioId: 'base', seed: 'audit-fixture' });
    const instructions = 'Synthetic test instructions', transcripts:any = {}, inputs:any[] = [], outputs:any[] = [];
    const at = '2026-09-17T00:00:00.000Z', entry = (type:string, raw:any) => ({ type, raw, at });
    for (const seat of session.seats) transcripts[seat.playerId] = [
      { type: 'session', playerId: seat.playerId, episodeId: session.episodeId, reasoningAvailability: 'not-provided' },
      entry('model-input', { role: 'user', content: instructions }), entry('model-output', { role: 'assistant', content: '{"ready":true}' })];
    for (let turn = 1; turn < 100; turn++) {
      const seat = session.seats[(turn - 1) % 3], playerId = seat.playerId;
      const observed = authority.observe(session.episodeId, seat.token), view = structuredClone(observed.view), trace = transcripts[playerId];
      if (observed.status !== 'active') break;
      const compact = turn > 1;
      if (compact) view.hands = Object.fromEntries(Object.entries(view.hands).map(([id, hand]:any) => [id,
        hand.map((c:any) => [c.index, c.id, c.color ?? null, c.value ?? null,
          c.possibleColors.length === 5 ? '*' : c.possibleColors.join('|'), c.possibleValues.length === 5 ? '*' : c.possibleValues.join('')])]));
      const input = { ...(compact ? { handColumns: ['index', 'id', 'color', 'value', 'possibleColors', 'possibleValues'],
        legend: 'null=未显示；候选颜色以|分隔，候选数字逐位列出；*=全部五色或1至5。无信息删减。' } : {}),
        playerId, observationId: observed.observationId, view,
        publicEventsSincePreviousTurn: observed.updates.map((u:any) => u.view.lastEvent).filter(Boolean),
        availableActionTypes: observed.legalActions.map(a => a.type) };
      const text = 'GAME_TURN\n' + JSON.stringify(input), endpoint = `https://coop.neutrinophysics.cn/api/v1/episodes/${session.episodeId}`;
      trace.push(entry('tool-call', { callId: `get-${turn}`, method: 'GET', url: endpoint + '/observation' }),
        entry('tool-result', { callId: `get-${turn}`, status: 200, body: redact(observed) }), entry('model-input', { role: 'user', content: text }));
      inputs.push({ playerId, text });
      const action = turn <= 3 ? { type: 'hint', target: session.seats[turn % 3].playerId, kind: 'value', value: 5 }
        : turn === 4 ? { type: 'discard', index: 0 } : { type: 'play', index: 0 };
      const reply = { action, decisionSummary: 'Synthetic legal action, not a model explanation.' }, original = JSON.stringify(reply);
      const command = { observationId: observed.observationId, decisionToken: observed.decisionToken, ...reply };
      const result = authority.submit(session.episodeId, seat.token, `fixture-${turn}`, command);
      assert.equal(result.body.accepted, true);
      trace.push(entry('model-output', { role: 'assistant', content: original }),
        entry('tool-call', { callId: `act-${turn}`, method: 'POST', url: endpoint + '/actions', body: redact(command), idempotencyKey: `fixture-${turn}` }),
        entry('tool-result', { callId: `act-${turn}`, ...redact(result) }));
      outputs.push({ playerId, text: original });
      if (result.body.observation.status === 'completed') break;
    }
    return { rollout: authority.getRollout(session.episodeId), replay: authority.verifyReplay(session.episodeId),
      transcripts, inputs, outputs, instructions };
  } finally { authority.close(); }
}

test('relay audit accepts independently generated server evidence and verifies public scoring', () => {
  const sample = fixture(), report = auditRelay(sample);
  assert.equal(report.actionCount, sample.rollout.summary.actionCount);
  assert.equal(report.outcome.score, 0);
  assert.equal(report.finalErrors, 3);
  assert.equal(report.result, 'passed-with-capture-limitations');
});

test('relay audit detects a leaked own card, replaced action, legend coaching and missing receipt', () => {
  const original = fixture();
  const alterInput = (sample:any, n:number, change:(value:any)=>void) => {
    const prior = sample.inputs[n].text, value = JSON.parse(prior.slice('GAME_TURN\n'.length)); change(value);
    const next = 'GAME_TURN\n' + JSON.stringify(value); sample.inputs[n].text = next;
    sample.transcripts[sample.inputs[n].playerId].find((e:any) => e.type === 'model-input' && e.raw.content === prior).raw.content = next;
  };
  let sample = structuredClone(original);
  alterInput(sample, 0, value => { value.view.hands.p1[0].color = 'red'; value.view.hands.p1[0].value = 5; });
  assert.throws(() => auditRelay(sample), /Own actual card leaked/);
  sample = structuredClone(original);
  const output = sample.transcripts.p1.find((e:any) => e.type === 'model-output' && e.raw.content !== '{"ready":true}');
  const reply = JSON.parse(output.raw.content); reply.action.value = 1; output.raw.content = JSON.stringify(reply);
  sample.outputs[0].text = output.raw.content;
  assert.throws(() => auditRelay(sample), /Relay changed the action/);
  sample = structuredClone(original); alterInput(sample, 1, value => { value.legend += ' Play slot 0 now.'; });
  assert.throws(() => auditRelay(sample));
  sample = structuredClone(original);
  sample.transcripts.p1.splice(sample.transcripts.p1.findIndex((e:any) => e.type === 'tool-result'), 1);
  assert.throws(() => auditRelay(sample), /Missing tool request or receipt/);
});

test('relay audit rejects missing, duplicated and extra records instead of auditing only a matching subset', () => {
  const original = fixture();
  let sample = structuredClone(original);
  sample.inputs.pop();
  assert.throws(() => auditRelay(sample), /Missing\/extra turn input/);
  sample = structuredClone(original); sample.outputs.push(structuredClone(sample.outputs[0]));
  assert.throws(() => auditRelay(sample), /Missing\/extra turn output/);
  sample = structuredClone(original);
  sample.transcripts.p1.splice(sample.transcripts.p1.findIndex((e:any) => e.type === 'model-output' && e.raw.content !== '{"ready":true}'), 1);
  assert.throws(() => auditRelay(sample), /Missing\/extra captured responses/);
  sample = structuredClone(original);
  const prompts = sample.transcripts.p1.filter((e:any) => e.type === 'model-input').slice(1);
  prompts.at(-1).raw.content = prompts[0].raw.content;
  assert.throws(() => auditRelay(sample), /Duplicate captured observation/);
  sample = structuredClone(original);
  // A complete extra turn still must not be silently ignored when no server action binds it.
  const extra = structuredClone(sample.transcripts.p1.slice(3, 9));
  for (const entry of extra) {
    if (entry.raw.callId) entry.raw.callId += '-extra';
    if (entry.type === 'model-input') {
      const input = JSON.parse(entry.raw.content.slice('GAME_TURN\n'.length)); input.observationId = 'extra-observation';
      entry.raw.content = 'GAME_TURN\n' + JSON.stringify(input);
    }
    if (entry.type === 'tool-call' && entry.raw.body) entry.raw.body.observationId = 'extra-observation';
  }
  sample.transcripts.p1.push(...extra);
  assert.throws(() => auditRelay(sample), /Missing\/extra captured prompts/);
  sample = structuredClone(original);
  const accepted = sample.rollout.frames.filter((f:any) => f.kind === 'accepted');
  accepted[3].observed = structuredClone(accepted[0].observed);
  assert.throws(() => auditRelay(sample), /Duplicate server action observation/);
});

test('relay audit binds a successful replay to the supplied rollout count and final state hash', () => {
  const original = fixture();
  for (const value of [undefined, original.replay.acceptedActions + 1]) {
    const sample:any = structuredClone(original); sample.replay.acceptedActions = value;
    assert.throws(() => auditRelay(sample), /Replay action count differs/);
  }
  for (const value of [undefined, '0'.repeat(64)]) {
    const sample:any = structuredClone(original); sample.replay.finalStateHash = value;
    assert.throws(() => auditRelay(sample), /Replay final state hash differs/);
  }
});

test('relay audit binds tool receipts, request IDs and transcript order to each server action', () => {
  const original = fixture();
  let sample = structuredClone(original);
  sample.transcripts.p1.find((e:any) => e.type === 'tool-call' && e.raw.method === 'POST').raw.idempotencyKey = 'unrelated-request';
  assert.throws(() => auditRelay(sample), /Action request ID differs/);
  sample = structuredClone(original);
  sample.transcripts.p1.find((e:any) => e.type === 'tool-result' && e.raw.body.observationId).raw.body.view.hints--;
  assert.throws(() => auditRelay(sample), /Observation receipt differs/);
  sample = structuredClone(original);
  sample.transcripts.p1.find((e:any) => e.type === 'tool-result' && e.raw.body.accepted).raw.body.observation.view.hints++;
  assert.throws(() => auditRelay(sample), /Action receipt view differs/);
  sample = structuredClone(original);
  const trace = sample.transcripts.p1, input = trace.findIndex((e:any) => e.type === 'model-input' && e.raw.content.startsWith('GAME_TURN'));
  [trace[input], trace[input + 1]] = [trace[input + 1], trace[input]];
  assert.throws(() => auditRelay(sample), /input, response, action order/);
});

test('audit inference respects joint hand constraints and card multiplicities without hidden faces', () => {
  const colors = ['white', 'red', 'blue', 'yellow', 'green'], copies = [0, 3, 2, 2, 2, 1], discard:any[] = [];
  for (const color of colors) for (let value = 1; value <= 5; value++) {
    const remaining = value === 1 && ['red', 'green'].includes(color) ? 1 : 0;
    for (let n = 0; n < copies[value] - remaining; n++) discard.push({ color, value });
  }
  const view = { fireworks: Object.fromEntries(colors.map(color => [color, 0])), discard, deckCount: 0,
    hands: { p1: [{ index: 0, possibleColors: ['red', 'green'], possibleValues: [1] },
      { index: 1, possibleColors: ['green'], possibleValues: [1] }], p2: [], p3: [] } };
  assert.deepEqual(feasibleIdentities(view, 'p1', 0), [{ color: 'red', value: 1 }]);
  view.hands.p1[1].possibleColors = ['red', 'green'];
  assert.deepEqual(feasibleIdentities(view, 'p1', 0), [{ color: 'red', value: 1 }, { color: 'green', value: 1 }]);
});
