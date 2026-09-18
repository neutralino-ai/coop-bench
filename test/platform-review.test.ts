import test from 'node:test';
import assert from 'node:assert/strict';
import { Authority } from '../src/authority.ts';
import { createApi } from '../src/server.ts';
import { createPlayerTools } from '../src/agent-tools.ts';
import { takeTime } from '../src/games/take-time.ts';

test('Retrying an old committed tool call must not roll back the client current observation', async () => {
  const authority = new Authority(':memory:', [takeTime], 'review-retry');
  const server = createApi(authority, 'coordinator-token-for-platform-review');
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const created = authority.create('take-time', { playerCount: 3, scenarioId: 'official-clock-1-1', seed: 'old-receipt-review' });
    const tools = createPlayerTools({ baseUrl, episodeId: created.episodeId, gameId: 'take-time', token: created.seats[0].token });
    await tools.call('observe', {});
    const firstCommand = { requestId: 'message-one', action: { type: 'speak', text: 'First plan.' } };
    const first = await tools.call('send_message', firstCommand) as any;
    assert.equal(first.httpStatus, 200);
    const second = await tools.call('send_message', { requestId: 'message-two', action: { type: 'speak', text: 'Second plan.' } }) as any;
    assert.equal(second.httpStatus, 200);
    assert.notEqual(second.observation.decisionToken, first.observation.decisionToken);
    assert.deepEqual(await tools.call('send_message', firstCommand), first, 'A retry still returns the exact original receipt.');
    const third = await tools.call('act', { requestId: 'look-after-old-retry', action: { type: 'look_hand' } }) as any;
    assert.equal(third.httpStatus, 200, `Old receipt replaced the current cached observation: ${JSON.stringify(third.error)}`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    authority.close();
  }
});
