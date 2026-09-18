import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createReadStream, openSync, closeSync, writeSync, fsyncSync, fstatSync, readSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

export const MESSAGE_ENVELOPE_BYTES = 48 * 1024;
export const MESSAGE_FRAGMENT_BYTES = 16 * 1024;
const MAX_RAW_BYTES = 64 * 1024 * 1024;
const SCHEMA = 'coop-agent-message-outbox/v1';
const availability = new Set(['provided', 'summary-only', 'not-provided', 'redacted']);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const wait = ms => new Promise(done => setTimeout(done, ms));
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
function check(condition, message) { if (!condition) throw Error(message); }
function text(value, max = 200) { return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value); }
function baseUrl(value) {
  const url = new URL(value);
  check(!url.username && !url.password && !url.search && !url.hash && ['https:', 'http:'].includes(url.protocol)
    && (url.protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)),
  'Use HTTPS, or HTTP on localhost, without URL credentials/query/fragment.');
  return url.href.replace(/\/$/, '');
}
/** Reject values JSON would silently alter/drop. Raw means the caller's actual
 * JSON body, not an HTTP envelope containing authentication headers. */
function snapshot(value) {
  const pending = [value], visited = new WeakSet();
  while (pending.length) {
    const entry = pending.pop();
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') continue;
    if (typeof entry === 'number') { check(Number.isFinite(entry), 'Capture requires finite JSON numbers.'); continue; }
    check(typeof entry === 'object', 'Capture accepts plain JSON only; undefined, functions and bigint are not silently discarded.');
    check(Array.isArray(entry) || [Object.prototype, null].includes(Object.getPrototypeOf(entry)), 'Capture requires plain JSON objects.');
    if (visited.has(entry)) continue;
    visited.add(entry);
    const descriptors = Object.getOwnPropertyDescriptors(entry);
    check(Object.getOwnPropertySymbols(entry).length === 0, 'Capture cannot silently discard symbol keys.');
    if (Array.isArray(entry)) {
      const keys = Object.keys(entry);
      check(keys.length === entry.length && keys.every(key => Number.isSafeInteger(Number(key)) && String(Number(key)) === key
        && Number(key) >= 0 && Number(key) < entry.length), 'Capture cannot silently alter sparse arrays or array properties.');
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(entry) && key === 'length') continue;
      check(descriptor.enumerable && Object.hasOwn(descriptor, 'value'), 'Capture requires enumerable data properties, not getters.');
      pending.push(descriptor.value);
    }
  }
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw Error('Capture requires finite, non-cyclic JSON.'); }
  check(Buffer.byteLength(serialized) <= MAX_RAW_BYTES, 'A logical capture may be at most 64 MiB; no data was truncated.');
  const plain = JSON.parse(serialized);
  // Capture bytes are canonical JSON values, not the provider's HTTP wire bytes.
  // This survives server key ordering for both inline raw and fragment records.
  return { value: plain, bytes: Buffer.from(canonical(plain)) };
}
function fits(envelope) {
  if (Buffer.byteLength(JSON.stringify(envelope)) > MESSAGE_ENVELOPE_BYTES) return false;
  const pending = [[envelope, 0]]; let nodes = 0;
  while (pending.length) {
    const [value, depth] = pending.pop();
    if (++nodes > 8192 || depth > 32) return false;
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) return false;
      pending.push([child, depth + 1]);
    }
  }
  return true;
}
function metadata(input = {}) {
  const copy = snapshot(input).value;
  check(copy && !Array.isArray(copy) && typeof copy === 'object', 'Capture metadata must be an object.');
  const allowed = ['model', 'provider', 'requestId', 'observationId', 'tokenUsage', 'reasoningAvailability'];
  check(Object.keys(copy).every(key => allowed.includes(key)), 'Unknown capture metadata field.');
  for (const key of ['model', 'provider', 'requestId', 'observationId']) if (copy[key] !== undefined) check(text(copy[key]), `Invalid ${key} metadata.`);
  if (copy.tokenUsage !== undefined) check(copy.tokenUsage && typeof copy.tokenUsage === 'object' && !Array.isArray(copy.tokenUsage)
    && Buffer.byteLength(JSON.stringify(copy.tokenUsage)) <= 4096, 'tokenUsage must be a JSON object of at most 4 KiB; full usage can stay in raw.');
  check(copy.reasoningAvailability === undefined || availability.has(copy.reasoningAvailability), 'Invalid reasoning availability.');
  return copy;
}

/** Reassemble one logical capture, including records read back from the server.
 * Reject incomplete, mixed, duplicate, altered or noncanonical fragments. */
export function reassembleCapture(envelopes) {
  check(Array.isArray(envelopes) && envelopes.length > 0, 'Supply every envelope for one logical capture.');
  const first = envelopes[0]?.message?.capture;
  check(first && first.schema === 'coop-agent-capture/v1' && first.serialization === 'canonical-json/v1'
    && typeof first.logicalId === 'string' && /^[a-f0-9]{64}$/.test(first.sha256)
    && Number.isSafeInteger(first.totalBytes) && first.totalBytes > 0 && first.totalBytes <= MAX_RAW_BYTES, 'Invalid capture metadata.');
  let bytes;
  if (first.encoding === 'json') {
    check(envelopes.length === 1 && Object.hasOwn(envelopes[0].message, 'raw') && first.fragment !== true, 'Inline capture must contain one raw JSON value.');
    bytes = snapshot(envelopes[0].message.raw).bytes;
  } else {
    check(first.encoding === 'base64' && first.fragment === true && Number.isSafeInteger(first.count)
      && first.count === Math.ceil(first.totalBytes / MESSAGE_FRAGMENT_BYTES) && first.count === envelopes.length, 'Capture fragments are incomplete.');
    const chunks = new Map();
    for (const envelope of envelopes) {
      const capture = envelope?.message?.capture, data = envelope?.message?.dataBase64;
      check(capture && ['schema', 'serialization', 'logicalId', 'event', 'totalBytes', 'sha256', 'encoding', 'fragment', 'count']
        .every(key => capture[key] === first[key]), 'Mixed logical captures cannot be reassembled.');
      check(Number.isSafeInteger(capture.index) && capture.index >= 0 && capture.index < first.count && !chunks.has(capture.index), 'Duplicate or invalid fragment index.');
      check(typeof data === 'string' && data.length <= Math.ceil(MESSAGE_FRAGMENT_BYTES / 3) * 4
        && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data), 'Invalid fragment base64.');
      const chunk = Buffer.from(data, 'base64');
      check(chunk.toString('base64') === data && chunk.length === Math.min(MESSAGE_FRAGMENT_BYTES, first.totalBytes - capture.index * MESSAGE_FRAGMENT_BYTES), 'Fragment size or base64 is invalid.');
      chunks.set(capture.index, chunk);
    }
    bytes = Buffer.concat(Array.from({ length: first.count }, (_, index) => chunks.get(index)));
  }
  check(bytes.length === first.totalBytes && sha(bytes) === first.sha256, 'Capture size or SHA256 mismatch.');
  let raw;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw Error('Captured bytes are not valid UTF8 JSON.'); }
  check(snapshot(raw).bytes.equals(bytes), 'Capture does not use the declared canonical JSON serialization.');
  return raw;
}

/** One recorder owns one seat's stream. SQLite holds only a cross-process
 * writer lock; the append-only JSONL is the durable, inspectable outbox.
 * An OS/process crash releases the lock without deleting any captured data. */
export class AgentMessageRecorder {
  #options; #fetch; #sleep; #fd; #lock; #file; #endpoint; #header;
  #pending = new Map(); #next = 0; #acked = -1; #seal = null; #sealed = false;
  #tail = Promise.resolve(); #closing = false; #broken = false;
  static async open(options, dependencies = {}) {
    const recorder = new AgentMessageRecorder();
    await recorder.#open(options, dependencies);
    return recorder;
  }
  async #open(options, dependencies) {
    const base = baseUrl(options.baseUrl);
    check(text(options.episodeId) && text(options.seatToken, 256) && /^[A-Za-z0-9._~+\/-]+=*$/.test(options.seatToken), 'A valid episodeId and seatToken are required.');
    check(typeof options.outboxFile === 'string' && options.outboxFile.length > 0, 'An outboxFile is required.');
    const scope = options.scope ?? 'JSON model requests/responses and tool events explicitly supplied to this recorder; excludes uncaptured provider internals.';
    check(text(scope, 2000), 'Describe the actual capture scope in at most 2000 characters.');
    const defaults = metadata({ ...(options.model ? { model: options.model } : {}), ...(options.provider ? { provider: options.provider } : {}) });
    const retries = options.retries ?? 3, timeoutMs = options.timeoutMs ?? 30000;
    check(Number.isInteger(retries) && retries >= 0 && retries <= 6, 'retries must be an integer from zero to six.');
    check(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000, 'timeoutMs must be 1–60000.');
    this.#options = { base, episodeId: options.episodeId, seatToken: options.seatToken, scope, defaults, retries, timeoutMs };
    this.#fetch = dependencies.fetchImpl ?? fetch; this.#sleep = dependencies.sleep ?? wait;
    this.#file = resolve(options.outboxFile); this.#endpoint = `${base}/episodes/${encodeURIComponent(options.episodeId)}/messages`;
    const binding = sha(JSON.stringify([base, options.episodeId, options.seatToken]));
    mkdirSync(dirname(this.#file), { recursive: true, mode: 0o700 });
    try {
      const lockFile = this.#file + '.lock.sqlite';
      this.#lock = new DatabaseSync(lockFile); chmodSync(lockFile, 0o600);
      this.#lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
      this.#fd = openSync(this.#file, 'a+'); chmodSync(this.#file, 0o600);
      const size = fstatSync(this.#fd).size;
      if (size) {
        const last = Buffer.alloc(1); readSync(this.#fd, last, 0, 1, size - 1);
        check(last[0] === 10, 'Outbox has a torn final line. Preserve it for recovery; no data will be skipped or uploaded.');
        const lines = createInterface({ input: createReadStream(this.#file), crlfDelay: Infinity });
        for await (const line of lines) { check(line.length > 0, 'Outbox contains an empty/corrupt record.'); this.#load(JSON.parse(line)); }
        check(this.#header?.schema === SCHEMA && this.#header.binding === binding, 'Outbox belongs to another server, episode or seat.');
        check(this.#header.scope === scope && canonical(this.#header.defaults) === canonical(defaults), 'Resume with the original capture scope/model/provider settings.');
      } else {
        this.#header = { type: 'header', schema: SCHEMA, binding, baseUrl: base, episodeId: options.episodeId,
          scope, defaults, createdAt: new Date().toISOString() };
        this.#append(this.#header);
      }
    } catch (error) {
      if (this.#fd !== undefined) closeSync(this.#fd);
      this.#fd = undefined;
      if (this.#lock) { this.#lock.close(); this.#lock = null; }
      if (String(error.message).includes('database is locked')) throw Error('Another recorder owns this outbox; use one writer per seat stream.');
      throw error;
    }
  }
  #load(record) {
    if (!this.#header) { check(record.type === 'header' && record.schema === SCHEMA, 'Missing outbox header.'); this.#header = record; return; }
    if (record.type === 'enqueue') {
      check(!this.#seal && Array.isArray(record.envelopes) && record.envelopes.length > 0, 'Invalid outbox enqueue.');
      for (const envelope of record.envelopes) {
        check(envelope.sequence === this.#next && fits(envelope), 'Outbox sequence or envelope is corrupt.');
        this.#pending.set(this.#next++, envelope);
      }
    } else if (record.type === 'ack') {
      const envelope = this.#pending.get(record.sequence);
      check(record.sequence === this.#acked + 1 && envelope && record.messageId === envelope.messageId && record.sha256 === sha(canonical(envelope)), 'Outbox acknowledgement is corrupt.');
      this.#pending.delete(record.sequence); this.#acked = record.sequence;
    } else if (record.type === 'seal') {
      check(!this.#seal && ['partial', 'complete'].includes(record.completion?.completeness), 'Invalid outbox seal.'); this.#seal = record.completion;
    } else if (record.type === 'sealed') {
      check(this.#seal && !this.#sealed && this.#pending.size === 0 && record.lastSequence === this.#next - 1
        && record.sha256 === sha(canonical(this.#seal)), 'Invalid outbox completion acknowledgement.'); this.#sealed = true;
    } else throw Error('Unknown outbox record; nothing will be discarded.');
  }
  #append(record) {
    check(!this.#broken, 'Outbox write failed previously; close and inspect it before resuming.');
    const bytes = Buffer.from(JSON.stringify(record) + '\n');
    try { let offset = 0; while (offset < bytes.length) offset += writeSync(this.#fd, bytes, offset, bytes.length - offset); fsyncSync(this.#fd); }
    catch (error) { this.#broken = true; throw error; }
  }
  #queue(work) {
    check(!this.#closing && !this.#broken, 'Recorder is closed or its outbox requires recovery.');
    const result = this.#tail.then(work);
    this.#tail = result.catch(() => {}); // Caller still receives the original rejected promise.
    return result;
  }
  async #post(suffix, payload) {
    const body = JSON.stringify(payload);
    for (let attempt = 0; attempt <= this.#options.retries; attempt++) {
      let response, data;
      try {
        response = await this.#fetch(this.#endpoint + suffix, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.#options.timeoutMs),
          headers: { Authorization: `Bearer ${this.#options.seatToken}`, 'Content-Type': 'application/json' }, body });
        const chunks = []; let size = 0;
        for await (const chunk of response.body ?? []) {
          size += chunk.byteLength;
          check(size <= 256 * 1024, 'Server response exceeds the recorder response limit.'); chunks.push(chunk);
        }
        data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        if (attempt === this.#options.retries) throw Error('Message delivery failed. Durable outbox retained; call resume() with the same outbox.');
        await this.#sleep(500 * (attempt + 1)); continue;
      }
      if (response.ok) return data;
      const code = /^[A-Z_]{1,64}$/.test(data?.error?.code ?? '') ? data.error.code : 'REQUEST_FAILED';
      if ((response.status === 429 && code === 'RATE_LIMITED' || response.status >= 500) && attempt < this.#options.retries) {
        const seconds = Number(response.headers.get('retry-after'));
        await this.#sleep(Math.min(30000, Math.max(500, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000))); continue;
      }
      throw Error(`Message delivery rejected: HTTP ${response.status} ${code}. Durable outbox retained; completeness remains unconfirmed.`);
    }
  }
  async #flush() {
    while (this.#pending.size) {
      const sequence = this.#acked + 1, envelope = this.#pending.get(sequence);
      check(envelope, 'Outbox sequence gap.');
      const receipt = await this.#post('', envelope);
      check(Object.keys(envelope).every(key => canonical(receipt[key]) === canonical(envelope[key])), 'Server acknowledgement does not match the captured message; outbox retained.');
      this.#append({ type: 'ack', sequence, messageId: envelope.messageId, sha256: sha(canonical(envelope)) });
      this.#pending.delete(sequence); this.#acked = sequence;
    }
    if (this.#seal && !this.#sealed) {
      const receipt = await this.#post('/complete', this.#seal);
      check(receipt.lastSequence === this.#next - 1 && Object.keys(this.#seal).every(key => canonical(receipt[key]) === canonical(this.#seal[key])), 'Server completion does not match the declared scope and sequence; outbox retained.');
      this.#append({ type: 'sealed', lastSequence: receipt.lastSequence, sha256: sha(canonical(this.#seal)) }); this.#sealed = true;
    }
    return this.status();
  }
  #record(raw, details, event, kind, role) {
    check(!this.#closing && !this.#seal && !this.#broken, 'Cannot append after seal was requested or recorder closed.');
    // Snapshot happens synchronously before yielding, including mutable metadata.
    const captured = snapshot(raw), meta = { ...this.#options.defaults, ...metadata(details) };
    const logicalId = randomUUID(), firstSequence = this.#next, clientAt = new Date().toISOString();
    const capture = { schema: 'coop-agent-capture/v1', serialization: 'canonical-json/v1', logicalId, event, totalBytes: captured.bytes.length, sha256: sha(captured.bytes) };
    const outer = { kind, ...meta, reasoningAvailability: meta.reasoningAvailability ?? 'not-provided', clientAt };
    const one = { sequence: firstSequence, messageId: `${logicalId}:0`, ...outer, message: { role, capture: { ...capture, encoding: 'json' }, raw: captured.value } };
    let envelopes = [one];
    if (!fits(one)) {
      const count = Math.ceil(captured.bytes.length / MESSAGE_FRAGMENT_BYTES);
      envelopes = Array.from({ length: count }, (_, index) => ({ sequence: firstSequence + index, messageId: `${logicalId}:${index}`, ...outer,
        message: { role, capture: { ...capture, encoding: 'base64', fragment: true, index, count },
          dataBase64: captured.bytes.subarray(index * MESSAGE_FRAGMENT_BYTES, (index + 1) * MESSAGE_FRAGMENT_BYTES).toString('base64') } }));
      check(envelopes.every(fits), 'Capture metadata cannot fit a safe envelope. No data was truncated.');
    }
    // A complete logical batch is durable before any of its fragments is sent.
    this.#append({ type: 'enqueue', logicalId, envelopes });
    for (const envelope of envelopes) this.#pending.set(this.#next++, envelope);
    return this.#queue(async () => { await this.#flush(); return { logicalId, firstSequence, lastSequence: firstSequence + envelopes.length - 1, delivered: true }; });
  }
  recordModelRequest(rawRequest, details = {}) { return this.#record(rawRequest, details, 'model-request', 'model-input', 'model-request'); }
  recordModelResponse(rawResponse, details = {}) { return this.#record(rawResponse, details, 'model-response', 'model-output', 'assistant'); }
  recordToolCall(rawCall, details = {}) { return this.#record(rawCall, details, 'tool-call', 'tool-call', 'assistant'); }
  recordToolResult(rawResult, details = {}) { return this.#record(rawResult, details, 'tool-result', 'tool-result', 'tool'); }
  resume() { return this.#queue(() => this.#flush()); }
  status() { return { scope: this.#options.scope, completeness: this.#sealed ? this.#seal.completeness : 'partial', sealed: this.#sealed,
    sealRequested: this.#seal !== null, messageCount: this.#next, acknowledgedThrough: this.#acked, pendingMessages: this.#pending.size }; }
  seal(declaration = {}) {
    check(!this.#closing && !this.#broken, 'Recorder is closed or requires recovery.');
    const supplied = snapshot(declaration).value;
    check(supplied && typeof supplied === 'object' && !Array.isArray(supplied), 'Completion declaration must be an object.');
    const completion = { scope: this.#options.scope, completeness: 'partial', reasoningAvailability: 'not-provided', ...supplied };
    check(['partial', 'complete'].includes(completion.completeness), 'Completeness must be partial or explicitly complete.');
    check(Object.keys(completion).every(key => ['scope', 'completeness', 'reasoningAvailability', 'model', 'provider', 'unavailable'].includes(key)), 'Unknown completion field.');
    check(completion.scope === this.#options.scope && availability.has(completion.reasoningAvailability), 'Completion must repeat the actual capture scope and explicit reasoning availability.');
    for (const key of ['model', 'provider']) if (completion[key] !== undefined) check(text(completion[key]), `Invalid completion ${key}.`);
    if (completion.unavailable !== undefined) check(Array.isArray(completion.unavailable) && completion.unavailable.length <= 16 && completion.unavailable.every(value => text(value)), 'List at most 16 unavailable fields.');
    check(Buffer.byteLength(JSON.stringify(completion)) + 128 <= 8192, 'Completion metadata is too large.');
    if (this.#seal) check(canonical(this.#seal) === canonical(completion), 'Cannot change an already requested completion.');
    else { this.#append({ type: 'seal', completion }); this.#seal = completion; }
    return this.#queue(() => this.#flush());
  }
  async close() {
    if (this.#closing) return this.#tail;
    this.#closing = true;
    await this.#tail;
    if (this.#fd !== undefined) { closeSync(this.#fd); this.#fd = undefined; }
    if (this.#lock) { this.#lock.close(); this.#lock = null; }
  }
}

export const createAgentMessageRecorder = (options, dependencies = {}) => AgentMessageRecorder.open(options, dependencies);
