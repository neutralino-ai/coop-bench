import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Authority } from '../src/authority.ts';
import { createApi } from '../src/server.ts';
import { takeTime } from '../src/games/take-time.ts';
import { uploadAgentArtifact } from '../scripts/upload-agent-artifact.mjs';

const noSleep = async () => {};
// These are synthetic client-provided transport fixtures, never model thinking
// or demonstrations of actual reasoning. We assert exact preservation of bytes.
const syntheticTrace = (rows = 1) => Buffer.from(Array.from({ length: rows }, (_, index) => JSON.stringify({
  fixture: 'synthetic-transport-test-not-real-model-reasoning', index,
  reasoning: 'Synthetic caller text: test byte preservation only.', response: '太阳 / moon 🌙',
})).join('\n') + '\n');
async function fixture(run: (context: any) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'coop-artifact-client-'));
  const authority = new Authority(':memory:', [takeTime], 'artifact-client-test');
  const server = createApi(authority, 'coordinator-artifact-client-local-test', { ratePolicy: {
    globalBurst: 1000, globalPerMinute: 1000, credentialBurst: 1000, credentialPerMinute: 1000,
  } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;
  const created = authority.create('take-time', { playerCount: 3, scenarioId: 'official-clock-1-1', seed: 'artifact-client-fixture' });
  authority.truncate(created.episodeId, 'Synthetic upload fixture: no model evaluation');
  const options = { baseUrl, episodeId: created.episodeId, seatToken: created.seats[0].token, file: join(dir, 'synthetic-trace.jsonl') };
  try { await run({ authority, created, options, dir }); }
  finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    authority.close();
    for (const entry of readdirSync(dir)) unlinkSync(join(dir, entry));
    rmdirSync(dir);
  }
}
async function download(options: any, artifact: any) {
  const response = await fetch(`${options.baseUrl}/episodes/${options.episodeId}/artifacts/${artifact.id}/content`, {
    headers: { Authorization: `Bearer ${options.seatToken}` },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.ok(response.headers.get('content-disposition')!.startsWith('attachment;'));
  return Buffer.from(await response.arrayBuffer());
}

test('artifact client retries lost manifest/chunk/complete receipts without duplicate evidence; large exact UTF8 trace downloads', async () => fixture(async ({ authority, options }) => {
  const bytes = syntheticTrace(1000); // Many 32 KiB chunks, above the normal JSON request limit.
  writeFileSync(options.file, bytes);
  const lost = new Set<string>();
  const result = await uploadAgentArtifact({ ...options, metadata: { model: 'synthetic-test-fixture', provider: 'local-test',
    reasoningAvailability: 'provided', tokenCounts: { reasoning: 0 } } }, { sleep: noSleep,
    fetchImpl: async (url: string, init: RequestInit) => {
      const response = await fetch(url, init);
      const stage = url.endsWith('/chunks') ? 'chunk' : url.endsWith('/complete') ? 'complete' : 'manifest';
      if (!lost.has(stage)) { lost.add(stage); await response.arrayBuffer(); throw Error('Synthetic lost response after server accepted request'); }
      return response;
    },
  });
  assert.equal(result.status, 'complete');
  assert.equal(result.provenance, 'client-supplied-unverified');
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await download(options, result), bytes);
  assert.equal(Number(authority.db.prepare('SELECT COUNT(*) AS n FROM artifacts').get()!.n), 1);
  assert.equal(Number(authority.db.prepare('SELECT COUNT(*) AS n FROM artifact_chunks').get()!.n), result.chunkCount);
  const repeated = await uploadAgentArtifact({ ...options, metadata: { model: 'synthetic-test-fixture', provider: 'local-test',
    reasoningAvailability: 'provided', tokenCounts: { reasoning: 0 } } }, { sleep: noSleep });
  assert.equal(repeated.id, result.id);
}));

test('artifact client resumes only missing chunks after an interrupted caller', async () => fixture(async ({ authority, options }) => {
  const bytes = syntheticTrace(500);
  writeFileSync(options.file, bytes);
  await assert.rejects(uploadAgentArtifact({ ...options, onProgress: () => { throw Error('Synthetic caller interrupted'); } }, { sleep: noSleep }), /Synthetic caller interrupted/);
  const partial = authority.listSeatArtifacts(options.episodeId, options.seatToken).artifacts[0];
  assert.deepEqual(partial.receivedChunks, [0]);
  const submitted: number[] = [];
  const result = await uploadAgentArtifact(options, { sleep: noSleep, fetchImpl: (url: string, init: RequestInit) => {
    if (url.endsWith('/chunks')) submitted.push(JSON.parse(init.body as string).index);
    return fetch(url, init);
  } });
  assert.equal(result.id, partial.id);
  assert.ok(!submitted.includes(0));
  assert.deepEqual(submitted, partial.missingChunks);
  assert.deepEqual(await download(options, result), bytes);
}));

test('artifact client uploads a stable byte snapshot if the source file is replaced after manifest creation', async () => fixture(async ({ options }) => {
  const original = syntheticTrace(500), changed = Buffer.alloc(original.length, 120);
  writeFileSync(options.file, original);
  let replaced = false;
  const result = await uploadAgentArtifact(options, { sleep: noSleep, fetchImpl: async (url: string, init: RequestInit) => {
    const response = await fetch(url, init);
    if (!replaced && url.endsWith('/artifacts')) { replaced = true; writeFileSync(options.file, changed); }
    return response;
  } });
  assert.equal(result.status, 'complete');
  assert.deepEqual(await download(options, result), original);
  // A repeat with the original file must resume/deduplicate rather than poison
  // the immutable upload by having sent bytes from two different snapshots.
  writeFileSync(options.file, original);
  const repeated = await uploadAgentArtifact(options, { sleep: noSleep });
  assert.equal(repeated.id, result.id);
}));

test('artifact client accepts an empty attachment and honors a temporary rate-limit response', async () => fixture(async ({ options }) => {
  writeFileSync(options.file, Buffer.alloc(0));
  const sleeps: number[] = [];
  let rateLimited = false;
  const result = await uploadAgentArtifact({ ...options, kind: 'attachment' }, { sleep: async (ms: number) => { sleeps.push(ms); },
    fetchImpl: (url: string, init: RequestInit) => {
      if (!rateLimited) { rateLimited = true; return Promise.resolve(new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), {
        status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '2' },
      })); }
      return fetch(url, init);
    },
  });
  assert.equal(result.byteLength, 0);
  assert.equal(result.chunkCount, 0);
  assert.equal(result.reasoningAvailability, 'not-provided');
  assert.ok(sleeps.includes(2000));
  assert.deepEqual(await download(options, result), Buffer.alloc(0));
}));

test('artifact client rejects insecure remote base URLs before reading files or sending credentials', async () => {
  let requests = 0;
  for (const baseUrl of ['http://example.invalid/api/v1', 'https://user:password@example.invalid/', 'https://example.invalid/?token=secret', 'https://example.invalid/#fragment']) {
    await assert.rejects(uploadAgentArtifact({ baseUrl, episodeId: 'synthetic-episode', seatToken: 'synthetic-seat-not-a-real-token', file: 'not-read' }, {
      fetchImpl: () => { requests++; throw Error('Must not send'); },
    }), /Use HTTPS/);
  }
  assert.equal(requests, 0);
});
