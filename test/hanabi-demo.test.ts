import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentResponse, redact } from '../scripts/hanabi-demo.mjs';

test('relay accepts exact agent moves and rejects side-channel actions or annotations', () => {
  const move = { action: { type: 'hint', target: 'p2', kind: 'value', value: 1 }, decisionSummary: 'Visible explanation only.' };
  assert.deepEqual(parseAgentResponse(JSON.stringify(move)), move);
  for (const action of [{ type: 'speak', text: 'red 1' }, { type: 'play', index: 0, note: 'red 1' }, { type: 'hint', target: 'p2', kind: 'value', value: '1' }])
    assert.throws(() => parseAgentResponse(JSON.stringify({ action, decisionSummary: '' })));
  assert.throws(() => parseAgentResponse(JSON.stringify({ ...move, publicMessage: 'red 1' })));
  assert.throws(() => parseAgentResponse(JSON.stringify({ ...move, decisionSummary: 'x'.repeat(1201) })));
  assert.throws(() => parseAgentResponse('```json\n' + JSON.stringify(move) + '\n```'));
});

test('relay hides authorization and decision credentials without changing visible cards or hints', () => {
  assert.deepEqual(redact({ Authorization: 'secret', decisionToken: 'secret', episodeSecret: 'secret', seatToken: 'secret',
    updates: [{ payload: { apiKey: 'secret', hands: { p2: [{ color: 'red', value: 1 }] }, touched: [0, 3] } }] }),
  { updates: [{ payload: { hands: { p2: [{ color: 'red', value: 1 }] }, touched: [0, 3] } }] });
});
