import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Authority } from '../src/authority.ts';
import { createApi } from '../src/server.ts';
import { takeTime } from '../src/games/take-time.ts';
import { createAgentMessageRecorder, reassembleCapture, MESSAGE_ENVELOPE_BYTES, MESSAGE_FRAGMENT_BYTES } from '../scripts/agent-message-recorder.mjs';

const scope = 'Synthetic unit-test JSON fixtures only; not actual provider reasoning or token usage.';
const noSleep = async () => {};
async function fixture(run: (context: any) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'coop-message-recorder-'));
  const authority = new Authority(':memory:', [takeTime], 'message-recorder-test');
  const server = createApi(authority, 'coordinator-message-recorder-local-test', { ratePolicy: {
    globalBurst: 1000, globalPerMinute: 1000, credentialBurst: 1000, credentialPerMinute: 1000,
  } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;
  const created = authority.create('take-time', { playerCount: 3, scenarioId: 'official-clock-1-1', seed: 'recorder-test-fixture' });
  const options = { baseUrl, episodeId: created.episodeId, seatToken: created.seats[0].token, outboxFile: join(dir, 'outbox.jsonl'), scope, retries: 0 };
  const open: any[] = [];
  const make = async (dependencies = {}, overrides = {}) => {
    const recorder = await createAgentMessageRecorder({ ...options, ...overrides }, { sleep: noSleep, ...dependencies }); open.push(recorder); return recorder;
  };
  const messages = () => authority.listSeatMessages(options.episodeId, options.seatToken, -1, 100).messages;
  try { await run({ authority, created, options, make, messages, dir }); }
  finally {
    for (const recorder of open) await recorder.close();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); authority.close();
    // This directory is an explicitly created test fixture; unlink only its files.
    for (const entry of readdirSync(dir)) unlinkSync(join(dir, entry)); rmdirSync(dir);
  }
}
const entries = (path: string) => readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
const sorted = (value: any): any => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;

test('recorder keeps actual supplied request/response JSON, roles, reasoning and token IDs; counts do not imply reasoning', async () => fixture(async ({ make, messages, options }) => {
  const recorder = await make();
  const request = { fixture: 'synthetic-not-a-real-model-call', model: 'test-model', messages: [
    { role: 'system', content: 'Synthetic system prompt.' }, { role: 'user', content: [{ type: 'text', text: '测试原始消息🌙' }] },
  ], tools: [{ type: 'function', function: { name: 'place', parameters: { type: 'object' } } }] };
  const response = { fixture: 'synthetic-not-provider-output', choices: [{ message: { role: 'assistant', content: null,
    reasoning_content: 'Synthetic reasoning fixture, never evidence of model thought.', tool_calls: [{ id: 'tool-1', function: { name: 'place', arguments: '{"position":1}' } }] } }],
  usage: { completion_tokens: 11, completion_tokens_details: { reasoning_tokens: 5 } }, token_ids: [101, 205, 900] };
  await recorder.recordModelRequest(request);
  await recorder.recordModelResponse(response, { reasoningAvailability: 'provided', tokenUsage: response.usage, requestId: 'provider-call-1' });
  await recorder.recordModelResponse({ usage: { reasoning_tokens: 9 } });
  await recorder.recordModelResponse({ output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Synthetic summary only.' }] }] }, { reasoningAvailability: 'summary-only' });
  await recorder.recordToolCall({ id: 'tool-1', arguments: { position: 1 } });
  await recorder.recordToolResult({ id: 'tool-1', result: { accepted: true } });
  const list = messages();
  assert.equal(list.length, 6);
  assert.deepEqual(list[0].message.raw, request); assert.deepEqual(list[1].message.raw, response);
  assert.equal(list[0].kind, 'model-input'); assert.equal(list[1].kind, 'model-output');
  assert.equal(list[1].reasoningAvailability, 'provided'); assert.deepEqual(list[1].tokenUsage, response.usage);
  assert.equal(list[2].reasoningAvailability, 'not-provided'); assert.equal(list[3].reasoningAvailability, 'summary-only');
  assert.equal(list[4].kind, 'tool-call'); assert.equal(list[5].message.role, 'tool');
  assert.deepEqual(reassembleCapture([list[0]]), request); assert.deepEqual(reassembleCapture([list[1]]), response);
  assert.equal(recorder.status().completeness, 'partial'); assert.equal(recorder.status().sealed, false);
  assert.ok(!readFileSync(options.outboxFile, 'utf8').includes(options.seatToken));
}));

test('large raw JSON fragments preserve exactly the UTF8 bytes, ordering, logical ID and SHA256 without truncation', async () => fixture(async ({ make, messages }) => {
  const recorder = await make();
  const raw = { fixture: 'synthetic-large-response', choices: [{ message: { role: 'assistant', reasoning_content: '月亮🌙'.repeat(15000), content: 'done' } }],
    usage: { reasoning_tokens: 123 }, token_ids: Array.from({ length: 100 }, (_, index) => index) };
  const bytes = Buffer.from(JSON.stringify(sorted(raw)));
  assert.ok(bytes.length > MESSAGE_ENVELOPE_BYTES);
  const result = await recorder.recordModelResponse(raw, { reasoningAvailability: 'provided' });
  const list = messages(), pieces = list.map((entry: any) => {
    assert.ok(Buffer.byteLength(JSON.stringify(entriesForTransport(entry))) <= MESSAGE_ENVELOPE_BYTES);
    const capture = entry.message.capture;
    assert.equal(capture.logicalId, result.logicalId); assert.equal(capture.encoding, 'base64'); assert.equal(capture.fragment, true);
    assert.equal(capture.totalBytes, bytes.length); assert.equal(capture.count, Math.ceil(bytes.length / MESSAGE_FRAGMENT_BYTES));
    assert.equal(capture.index, entry.sequence); assert.equal(capture.sha256, createHash('sha256').update(bytes).digest('hex'));
    const chunk = Buffer.from(entry.message.dataBase64, 'base64'); assert.ok(chunk.length <= MESSAGE_FRAGMENT_BYTES); return chunk;
  });
  assert.deepEqual(Buffer.concat(pieces), bytes);
  assert.deepEqual(JSON.parse(Buffer.concat(pieces).toString('utf8')), raw);
  assert.deepEqual(reassembleCapture([...list].reverse()), raw);
  assert.throws(() => reassembleCapture(list.slice(1)), /incomplete/);
  assert.throws(() => reassembleCapture([list[0], ...list.slice(0, -1)]), /Duplicate/);
  const altered = structuredClone(list); altered[0].message.dataBase64 = Buffer.alloc(pieces[0].length).toString('base64');
  assert.throws(() => reassembleCapture(altered), /SHA256 mismatch/);
}));
function entriesForTransport(entry: any) {
  const { episodeId: _, playerId: __, serverReceivedAt: ___, provenance: ____, ...original } = entry; return original;
}

test('outbox is written before the first network call; caller mutations cannot change queued raw or metadata', async () => fixture(async ({ make, options, messages }) => {
  let fetches = 0;
  const recorder = await make({ fetchImpl: (url: string, init: RequestInit) => {
    fetches++;
    const queued = entries(options.outboxFile).filter(entry => entry.type === 'enqueue');
    assert.equal(queued.length, 1); assert.equal(queued[0].envelopes[0].message.raw.messages[0].content, 'original');
    assert.equal(queued[0].envelopes[0].tokenUsage.output, 2);
    assert.equal(init.redirect, 'error'); return fetch(url, init);
  } });
  const input = { messages: [{ role: 'user', content: 'original' }] }, meta = { tokenUsage: { output: 2 } };
  const pending = recorder.recordModelRequest(input, meta);
  input.messages[0].content = 'mutated after call'; meta.tokenUsage.output = 999;
  await pending;
  assert.equal(fetches, 1); assert.equal(messages()[0].message.raw.messages[0].content, 'original');
  assert.equal(messages()[0].tokenUsage.output, 2);
}));

test('offline calls reject but remain locally queued and resume in sequence after reopening', async () => fixture(async ({ make, messages, options }) => {
  const recorder = await make({ fetchImpl: async () => { throw Error('Synthetic offline transport'); } });
  await assert.rejects(recorder.recordModelRequest({ fixture: 'offline-request' }), /Durable outbox retained/);
  await assert.rejects(recorder.recordModelResponse({ fixture: 'offline-response' }), /Durable outbox retained/);
  assert.equal(recorder.status().pendingMessages, 2); assert.equal(recorder.status().completeness, 'partial'); assert.equal(messages().length, 0);
  await recorder.close();
  const resumed = await make();
  assert.equal(resumed.status().pendingMessages, 2);
  await resumed.resume();
  assert.deepEqual(messages().map((entry: any) => entry.sequence), [0, 1]);
  assert.equal(resumed.status().pendingMessages, 0);
  assert.equal(entries(options.outboxFile).filter(entry => entry.type === 'ack').length, 2);
}));

test('lost accepted response retries identical sequence/messageId/body and never duplicates server evidence', async () => fixture(async ({ make, messages }) => {
  const requests: string[] = [];
  const recorder = await make({ fetchImpl: async (url: string, init: RequestInit) => {
    requests.push(init.body as string);
    const response = await fetch(url, init);
    if (requests.length === 1) { await response.arrayBuffer(); throw Error('Synthetic lost receipt after commit'); }
    return response;
  } }, { retries: 1 });
  await recorder.recordModelResponse({ fixture: 'actual-bytes-supplied-by-test', reasoning: 'Synthetic fixture.' }, { reasoningAvailability: 'provided' });
  assert.equal(requests.length, 2); assert.equal(requests[0], requests[1]); assert.equal(messages().length, 1);
  assert.equal(recorder.status().acknowledgedThrough, 0);
}));

test('only explicit complete claims completeness; the completion request is durable and resumes an uncertain seal', async () => fixture(async ({ make, options, authority }) => {
  let drop = true;
  const recorder = await make({ fetchImpl: async (url: string, init: RequestInit) => {
    const response = await fetch(url, init);
    if (url.endsWith('/complete') && drop) { drop = false; await response.arrayBuffer(); throw Error('Synthetic lost seal receipt'); }
    return response;
  } });
  await recorder.recordModelResponse({ fixture: 'synthetic-summary', summary: 'Unit-test summary.' }, { reasoningAvailability: 'summary-only' });
  assert.throws(() => recorder.seal({ scope, completeness: 'assumed-complete' }), /partial or explicitly complete/);
  assert.equal(recorder.status().sealRequested, false);
  authority.truncate(options.episodeId, 'Synthetic recorder test complete');
  const declaration = { scope, completeness: 'complete', reasoningAvailability: 'summary-only', unavailable: ['Provider private token IDs'] };
  await assert.rejects(recorder.seal(declaration), /Durable outbox retained/);
  assert.equal(recorder.status().completeness, 'partial'); assert.equal(recorder.status().sealRequested, true);
  assert.throws(() => recorder.recordToolResult({ fixture: 'too-late' }), /Cannot append/);
  await recorder.close();
  const resumed = await make(); await resumed.resume();
  assert.equal(resumed.status().completeness, 'complete'); assert.equal(resumed.status().sealed, true);
  const seal = authority.listSeatMessages(options.episodeId, options.seatToken).completion;
  assert.equal(seal.completeness, 'complete'); assert.equal(seal.lastSequence, 0); assert.equal(seal.scope, scope);
}));

test('explicit or default partial seals stay partial after reload and do not pressure callers to claim completeness', async () => fixture(async ({ make, options, authority }) => {
  const recorder = await make();
  await recorder.recordToolResult({ fixture: 'partial-capture' });
  authority.truncate(options.episodeId, 'Synthetic partial capture');
  await recorder.seal({ reasoningAvailability: 'summary-only', unavailable: ['Earlier model requests'] });
  assert.equal(recorder.status().sealed, true); assert.equal(recorder.status().completeness, 'partial');
  await recorder.close();
  const resumed = await make(); await resumed.resume();
  assert.equal(resumed.status().sealed, true); assert.equal(resumed.status().completeness, 'partial');
  assert.equal(authority.listSeatMessages(options.episodeId, options.seatToken).completion.completeness, 'partial');
  assert.throws(() => resumed.seal({ completeness: 'complete' }), /Cannot change/);
}));

test('JSON complexity or reserved provider keys are preserved through fragments; non-JSON input is explicitly rejected', async () => fixture(async ({ make, messages }) => {
  const recorder = await make();
  const raw = JSON.parse('{"fixture":"synthetic-provider-extension","constructor":"raw field, never executed"}');
  await recorder.recordModelResponse(raw);
  const part = messages()[0].message;
  assert.equal(part.capture.encoding, 'base64');
  assert.deepEqual(JSON.parse(Buffer.from(part.dataBase64, 'base64').toString('utf8')), raw);
  assert.throws(() => recorder.recordModelRequest({ omitted: undefined }), /plain JSON/);
  assert.throws(() => recorder.recordModelResponse({ invalid: NaN }), /finite JSON/);
  const cyclic: any = {}; cyclic.self = cyclic;
  assert.throws(() => recorder.recordModelResponse(cyclic), /non-cyclic/);
  const disguisedSparse: any = new Array(1); disguisedSparse.extra = 'would otherwise be silently discarded';
  assert.throws(() => recorder.recordModelResponse(disguisedSparse), /sparse arrays or array properties/);
  assert.equal(recorder.status().messageCount, 1);
}));

test('one outbox has one writer and cannot resume under another seat; torn JSONL fails closed without dropping bytes', async () => fixture(async ({ make, options, created }) => {
  const recorder = await make();
  await assert.rejects(make(), /Another recorder owns/);
  await recorder.recordToolResult({ fixture: 'synthetic-lock-test' }); await recorder.close();
  await assert.rejects(make({}, { seatToken: created.seats[1].token }), /another server, episode or seat/);
  appendFileSync(options.outboxFile, '{"type":"enqueue"');
  const corrupted = readFileSync(options.outboxFile);
  await assert.rejects(make(), /torn final line/);
  assert.deepEqual(readFileSync(options.outboxFile), corrupted);
}));

test('insecure remote or credential-bearing URLs are rejected before any network request', async () => {
  let requests = 0;
  for (const baseUrl of ['http://example.invalid/api/v1', 'https://user:password@example.invalid', 'https://example.invalid/?token=secret']) {
    await assert.rejects(createAgentMessageRecorder({ baseUrl }, { fetchImpl: () => { requests++; } }), /Use HTTPS/);
  }
  assert.equal(requests, 0);
});
