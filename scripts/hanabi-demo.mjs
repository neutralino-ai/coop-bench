// Three independent agents are relayed by the caller; this harness never selects a move.
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createAgentMessageRecorder } from './agent-message-recorder.mjs';
import { uploadAgentArtifact } from './upload-agent-artifact.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const privateDir = join(root, 'artifacts', 'cloud-private', 'hanabi-demo');
const publicDir = join(root, 'artifacts', 'hanabi-demo');
const sessionFile = join(privateDir, 'session.json');
const baseUrl = 'https://coop.neutrinophysics.cn/api/v1';
const provider = 'Codex subagent relay';
const scope = 'Actual relay user prompts, visible assistant replies, and HTTP game tool calls/results supplied to this recorder. Decision summaries are visible explanations, not hidden thinking.';
const unavailable = ['Internal system/developer prompts', 'Provider hidden reasoning', 'Provider token IDs and token usage', 'Tool use outside this relay'];
const digest = value => createHash('sha256').update(value).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const fail = message => { throw Error(message); };
function save(path, data, fresh = false) {
  const bytes = JSON.stringify(data, null, 2) + '\n';
  if (fresh) writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  else { const pending = path + '.pending'; writeFileSync(pending, bytes, { mode: 0o600 }); renameSync(pending, path); }
}
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['authorization', 'seattoken', 'decisiontoken', 'episodesecret', 'apikey', 'secretkey', 'token'].includes(key.toLowerCase()))
    .map(([key, child]) => [key, redact(child)])) : value;
}
export function parseAgentResponse(text) {
  const data = JSON.parse(text), exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  if (!exact(data, ['action', 'decisionSummary']) || typeof data.decisionSummary !== 'string' || data.decisionSummary.length > 1200)
    fail('Return only {action,decisionSummary}; decisionSummary must be a string of at most 1200 characters.');
  const a = data.action;
  if (a?.type === 'hint') {
    if (!exact(a, ['type', 'target', 'kind', 'value']) || !['p1', 'p2', 'p3'].includes(a.target)
      || !(a.kind === 'color' && ['white', 'red', 'blue', 'yellow', 'green'].includes(a.value)
        || a.kind === 'value' && Number.isInteger(a.value) && a.value >= 1 && a.value <= 5)) fail('Invalid hint action shape.');
  } else if (!['play', 'discard'].includes(a?.type) || !exact(a, ['type', 'index']) || !Number.isInteger(a.index) || a.index < 0 || a.index > 4)
    fail('Only hint, play, or discard actions are accepted.');
  return data;
}
function inputFile(value) {
  if (!value) fail('An input file is required.');
  const path = realpathSync(resolve(value)), within = relative(realpathSync(privateDir), path);
  if (!within || within === '..' || within.startsWith('..' + sep) || resolve(privateDir, within) !== path) fail('Put input files inside artifacts/cloud-private/hanabi-demo.');
  return path;
}
function owner() { return readFileSync(join(root, 'artifacts', 'cloud-private', 'owner.txt'), 'utf8').trim(); }
function shortResult(body, status = 200) {
  const obs = body.observation;
  return { httpStatus: status, accepted: body.accepted, error: body.error, nextPlayer: obs?.view?.current,
    status: obs?.status, errors: obs?.view?.errors, hints: obs?.view?.hints, fireworks: obs?.view?.fireworks,
    score: obs?.outcome?.score, outcome: obs?.outcome };
}

export async function run(args, cloudFetch) {
  const [mode, playerId, suppliedFile] = args;
  if (!['create', 'record-input', 'record-output', 'prepare', 'act', 'finish'].includes(mode)) fail('Usage: hanabi-demo.mjs create | record-input/record-output PLAYER FILE | prepare PLAYER | act PLAYER RESPONSE_FILE | finish');
  mkdirSync(privateDir, { recursive: true, mode: 0o700 }); mkdirSync(publicDir, { recursive: true });
  async function request(path, token, body, key) {
    const response = await cloudFetch(baseUrl + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json(); return { status: response.status, body: data };
  }
  const demand = result => { if (result.status < 200 || result.status > 299) fail(`Request rejected: HTTP ${result.status} ${result.body?.error?.code ?? 'REQUEST_FAILED'}.`); return result.body; };
  if (mode === 'create') {
    if (existsSync(sessionFile)) fail('This demo exists or creation is uncertain. Inspect the saved session; do not create another deal.');
    const token = owner(), before = demand(await request('/rollouts', token));
    const initial = { phase: 'creation-pending', beforeIds: before.items.map(item => item.episodeId), at: new Date().toISOString() };
    save(sessionFile, initial, true);
    const episode = demand(await request('/episodes', token, { gameId: 'hanabi', scenarioId: 'base', playerCount: 3, config: {} }));
    // Persist the creation response before any per-seat work so an interrupted setup is recoverable.
    save(sessionFile, { ...initial, phase: 'created', creation: episode, episodeId: episode.episodeId });
    for (const seat of episode.seats) {
      const dir = join(privateDir, seat.playerId); mkdirSync(dir, { recursive: true, mode: 0o700 });
      save(join(dir, 'seat.json'), { baseUrl, episodeId: episode.episodeId, playerId: seat.playerId, seatToken: seat.token }, true);
    }
    const publicSession = { episodeId: episode.episodeId, gameId: 'hanabi', scenarioId: 'base', playerCount: 3, at: initial.at,
      method: 'One unselected random deal; independent subagents receive only their own observation; the relay submits their exact selected actions.' };
    save(join(publicDir, 'session.json'), publicSession, true); console.log(JSON.stringify(publicSession)); return;
  }
  const session = readJson(sessionFile);
  if (session.phase !== 'created' || !session.episodeId) fail('Creation is incomplete or uncertain; inspect the saved session.');
  const endpoint = `/episodes/${encodeURIComponent(session.episodeId)}`;
  async function seatWork(id, work) {
    if (!['p1', 'p2', 'p3'].includes(id)) fail('Choose p1, p2, or p3.');
    const dir = join(privateDir, id), connection = readJson(join(dir, 'seat.json'));
    const transcript = join(dir, 'transcript.jsonl'), outbox = join(dir, 'messages-outbox.jsonl');
    const recorder = await createAgentMessageRecorder({ ...connection, outboxFile: outbox, scope, provider, timeoutMs: 60000 }, { fetchImpl: cloudFetch });
    const lines = () => existsSync(transcript) ? readFileSync(transcript, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    try {
      await recorder.resume();
      if (!existsSync(transcript)) appendFileSync(transcript, JSON.stringify({ type: 'session', schema: 'coop-relay-transcript/v1', episodeId: session.episodeId,
        playerId: id, scope, provider, reasoningAvailability: 'not-provided', unavailable, at: new Date().toISOString() }) + '\n', { mode: 0o600 });
      async function record(eventId, type, raw, metadata = {}) {
        const previous = lines().find(line => line.eventId === eventId);
        if (previous && JSON.stringify(previous.raw) !== JSON.stringify(raw)) fail('Capture ID reused with changed bytes.');
        const entry = previous ?? { eventId, type, raw, at: new Date().toISOString() };
        if (!previous) appendFileSync(transcript, JSON.stringify(entry) + '\n', { mode: 0o600 });
        // A durable enqueue can exist without an HTTP acknowledgement after a crash.
        // resume() sends it; inspecting its requestId avoids capturing a second copy.
        const already = readFileSync(outbox, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
          .some(line => line.type === 'enqueue' && line.envelopes.some(envelope => envelope.requestId === eventId));
        if (!already) await recorder[{ 'model-input': 'recordModelRequest', 'model-output': 'recordModelResponse', 'tool-call': 'recordToolCall', 'tool-result': 'recordToolResult' }[type]]
          (raw, { provider, reasoningAvailability: 'not-provided', requestId: eventId, ...metadata });
      }
      async function tool(path, body, key, stableCallId = randomUUID()) {
        await record(`call-${stableCallId}`, 'tool-call', { callId: stableCallId, url: baseUrl + path, method: body === undefined ? 'GET' : 'POST',
          ...(body === undefined ? {} : { body: redact(body) }), ...(key ? { idempotencyKey: key } : {}) }, body?.observationId ? { observationId: body.observationId } : {});
        let result;
        try { result = await request(path, connection.seatToken, body, key); }
        catch { await record(`result-${stableCallId}`, 'tool-result', { callId: stableCallId, error: 'Transport failed or response unavailable; command outcome may be uncertain.' });
          fail('Transport failed or response unavailable. Retry the same file; do not change the saved command.'); }
        await record(`result-${stableCallId}`, 'tool-result', { callId: stableCallId, ...redact(result) }); return result;
      }
      await work({ dir, connection, recorder, record, tool, transcript, outbox });
    } finally { await recorder.close(); }
  }
  if (mode === 'record-input' || mode === 'record-output' || mode === 'act') {
    const file = inputFile(suppliedFile), original = readFileSync(file, 'utf8');
    await seatWork(playerId, async ({ dir, connection, record, tool }) => {
      if (original.includes(connection.seatToken)) fail('Credential found in proposed relay text; do not send it to an agent.');
      const id = digest(file), operationPath = join(dir, `${mode}-${id}.json`);
      const operation = existsSync(operationPath) ? readJson(operationPath) : { textSha256: digest(original), captureId: randomUUID(), requestId: randomUUID() };
      if (operation.textSha256 !== digest(original)) fail('Input file changed after capture. Preserve it and use a new file for a new message.');
      if (!existsSync(operationPath)) save(operationPath, operation, true);
      await record(operation.captureId, mode === 'record-input' ? 'model-input' : 'model-output', { role: mode === 'record-input' ? 'user' : 'assistant', content: original });
      if (mode !== 'act') { console.log(JSON.stringify({ recorded: true, playerId, sha256: operation.textSha256 })); return; }
      const response = parseAgentResponse(original), latestPath = join(dir, 'observation.json');
      if (!operation.command) {
        const latest = readJson(latestPath);
        if (latest.status !== 'active' || latest.view?.current !== playerId) fail('Only the current player may act on its own prepared observation.');
        operation.command = { observationId: latest.observationId, decisionToken: latest.decisionToken, ...response };
        save(operationPath, operation);
      }
      if (!operation.result) {
        // This exact command and request ID remain on disk through an uncertain response.
        operation.result = await tool(endpoint + '/actions', operation.command, operation.requestId);
        save(operationPath, operation);
      }
      if (operation.result.body.observation && (!existsSync(latestPath)
        || (operation.result.body.observation.updateCursor ?? 0) >= (readJson(latestPath).updateCursor ?? 0))) save(latestPath, operation.result.body.observation);
      console.log(JSON.stringify(shortResult(operation.result.body, operation.result.status)));
      if (!operation.result.body.accepted) process.exitCode = 1;
    }); return;
  }
  if (mode === 'prepare') {
    await seatWork(playerId, async ({ dir, tool }) => {
      const latestPath = join(dir, 'observation.json'), latest = existsSync(latestPath) ? readJson(latestPath) : null;
      const observation = demand(await tool(endpoint + `/observation?after=${latest?.updateCursor ?? 0}`));
      save(latestPath, observation);
      const allowed = ['playerId', 'observationId', 'status', 'view', 'legalActions', 'updates', 'outcome'];
      console.log(JSON.stringify(Object.fromEntries(allowed.filter(key => Object.hasOwn(observation, key)).map(key => [key, redact(observation[key])])), null, 2));
    }); return;
  }
  const token = owner(), rollout = demand(await request(`/rollouts/${session.episodeId}`, token));
  if (rollout.summary.status === 'active') fail('Finish is only permitted after the game has ended.');
  const audit = demand(await request(endpoint + '/audit', token)), replay = demand(await request(endpoint + '/replay', token));
  save(join(publicDir, 'rollout.json'), rollout); save(join(publicDir, 'audit.json'), audit); save(join(publicDir, 'replay.json'), replay);
  for (const id of ['p1', 'p2', 'p3']) {
    let files, connection, dir;
    await seatWork(id, async seat => {
      ({ connection, dir } = seat); files = [seat.transcript, seat.outbox];
      await seat.recorder.seal({ completeness: 'partial', reasoningAvailability: 'not-provided', provider, unavailable });
    });
    for (const file of files) {
      const receipt = await uploadAgentArtifact({ ...connection, file, kind: 'agent-trace', metadata: { provider, reasoningAvailability: 'not-provided' } }, { fetchImpl: cloudFetch });
      save(join(dir, file.endsWith('transcript.jsonl') ? 'transcript-upload.json' : 'outbox-upload.json'), receipt);
    }
  }
  const artifacts = demand(await request(`/rollouts/${session.episodeId}/artifacts`, token)), downloads = [];
  for (const artifact of artifacts.artifacts) {
    if (artifact.status !== 'complete') continue;
    const response = await cloudFetch(`${baseUrl}/rollouts/${session.episodeId}/artifacts/${artifact.id}/content`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!response.ok) fail(`Artifact download failed: HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer()), valid = bytes.length === artifact.byteLength && digest(bytes) === artifact.sha256;
    downloads.push({ id: artifact.id, playerId: artifact.playerId, name: artifact.name, byteLength: bytes.length, sha256: artifact.sha256, sha256Valid: valid });
    if (!valid) fail('Artifact size or SHA256 mismatch.');
  }
  const verification = { at: new Date().toISOString(), episodeId: session.episodeId, status: rollout.summary.status,
    outcome: rollout.summary.outcome, replay, artifacts: downloads, captureScope: scope, completeness: 'partial', reasoningAvailability: 'not-provided', unavailable };
  save(join(publicDir, 'verification.json'), verification);
  console.log(JSON.stringify({ episodeId: session.episodeId, status: verification.status, outcome: verification.outcome, completedArtifacts: downloads.length, allSha256Valid: downloads.every(x => x.sha256Valid), replayValid: replay.valid }));
  if (downloads.length !== 6 || !replay.valid) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  try { const { cloudFetch } = await import('./cloud-http-client.mjs'); await run(process.argv.slice(2), cloudFetch); }
  catch (error) { console.error(error instanceof SyntaxError ? 'Invalid JSON response or saved file; original bytes remain preserved.' : error.message); process.exitCode = 1; }
}
