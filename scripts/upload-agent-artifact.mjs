import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const wait = ms => new Promise(done => setTimeout(done, ms));
const safeBase = value => {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol) ||
      (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw Error('Use HTTPS, or HTTP on localhost, without URL credentials/query/fragment.');
  return url.href.replace(/\/$/, '');
};
const mediaType = file => ({ '.json': 'application/json', '.jsonl': 'application/x-ndjson', '.ndjson': 'application/x-ndjson', '.txt': 'text/plain' }[extname(file).toLowerCase()] ?? 'application/octet-stream');
const allowedMetadata = new Set(['model', 'provider', 'reasoningAvailability', 'tokenCounts']);

/** Upload bytes actually supplied by the caller. Never generates or infers reasoning. */
export async function uploadAgentArtifact(options, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? fetch, sleep = dependencies.sleep ?? wait;
  const base = safeBase(options.baseUrl);
  if (typeof options.episodeId !== 'string' || !options.episodeId || typeof options.seatToken !== 'string' || !/^[A-Za-z0-9._~+\/-]+=*$/.test(options.seatToken)) throw Error('A valid episodeId and seatToken are required.');
  const file = resolve(options.file), handle = await open(file, 'r');
  let snapshot;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 64 * 1024 * 1024) throw Error('Choose a regular file of at most 64 MiB.');
    snapshot = Buffer.alloc(info.size); let offset = 0;
    while (offset < snapshot.length) {
      const { bytesRead } = await handle.read(snapshot, offset, snapshot.length - offset, offset);
      if (!bytesRead) throw Error('File changed while taking the upload snapshot; retry after it is closed.');
      offset += bytesRead;
    }
    if ((await handle.read(Buffer.alloc(1), 0, 1, snapshot.length)).bytesRead) throw Error('File grew while taking the upload snapshot; retry after it is closed.');
  } finally { await handle.close(); }
  // Hash and upload exactly the same bounded snapshot, even if a log is edited later.
  const sha256 = createHash('sha256').update(snapshot).digest('hex');
  const metadata = options.metadata ?? {};
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || Object.keys(metadata).some(key => !allowedMetadata.has(key))) throw Error('Unknown artifact metadata field.');
  const manifest = { name: options.name ?? basename(file), mediaType: options.mediaType ?? mediaType(file),
    kind: options.kind ?? 'agent-trace', byteLength: snapshot.length, sha256, reasoningAvailability: 'not-provided', ...metadata };
  const manifestKey = 'artifact-' + createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const verified = artifact => {
    if (artifact?.status !== 'complete' || artifact.sha256 !== sha256 || artifact.byteLength !== snapshot.length || typeof artifact.id !== 'string' || !artifact.id)
      throw Error('Artifact completion receipt does not match the uploaded file. Preserve the local file and retry; upload is not confirmed.');
    return artifact;
  };
  const endpoint = `${base}/episodes/${encodeURIComponent(options.episodeId)}/artifacts`;
  const request = async (url, body, key) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      let response;
      try {
        response = await fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
          headers: { Authorization: `Bearer ${options.seatToken}`, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
      } catch {
        // Each endpoint here is idempotent; retry the same bytes/key only.
        if (attempt === 5) throw Error('Network failure. Upload can be resumed by rerunning the same command.');
        await sleep(1000 * (attempt + 1)); continue;
      }
      let data;
      try { data = await response.json(); } catch { throw Error(`Invalid server response (HTTP ${response.status}).`); }
      if (response.ok) return data;
      if (response.status === 429 && data?.error?.code === 'RATE_LIMITED' && attempt < 5) {
        const seconds = Number(response.headers.get('retry-after'));
        await sleep(Math.min(60000, Math.max(1000, (Number.isFinite(seconds) ? seconds : 5) * 1000))); continue;
      }
      const code = /^[A-Z_]{1,50}$/.test(data?.error?.code ?? '') ? data.error.code : 'REQUEST_FAILED';
      throw Error(`Artifact request failed: HTTP ${response.status} ${code}. Saved uploads are preserved; rerun after resolving the error.`);
    }
  };
  let artifact = await request(endpoint, manifest, manifestKey);
  if (artifact.status === 'complete') return verified(artifact);
  if (artifact.chunkSize !== 32768 || !Array.isArray(artifact.missingChunks) || artifact.missingChunks.some(index => !Number.isInteger(index) || index < 0 || index >= Math.ceil(snapshot.length / artifact.chunkSize))) throw Error('Invalid upload manifest returned by server.');
    for (const index of artifact.missingChunks) {
      const buffer = snapshot.subarray(index * artifact.chunkSize, (index + 1) * artifact.chunkSize);
      await request(`${endpoint}/${encodeURIComponent(artifact.id)}/chunks`, { index, dataBase64: buffer.toString('base64') });
      options.onProgress?.({ artifactId: artifact.id, index, chunkCount: artifact.chunkCount });
      await sleep(350);
    }
  artifact = await request(`${endpoint}/${encodeURIComponent(artifact.id)}/complete`, {});
  return verified(artifact);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  try {
    const args = process.argv.slice(2), options = {};
    const allowed = ['--connection', '--file', '--kind', '--name', '--media-type', '--metadata', '--receipt'];
    for (let i = 0; i < args.length; i += 2) {
      if (!allowed.includes(args[i]) || Object.hasOwn(options, args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('Invalid arguments.');
      options[args[i]] = args[i + 1];
    }
    if (!options['--connection'] || !options['--file']) throw Error('Usage: node scripts/upload-agent-artifact.mjs --connection SEAT_JSON --file TRACE_JSONL [--metadata METADATA_JSON] [--kind agent-trace|attachment] [--receipt NEW_JSON_FILE]');
    const connection = JSON.parse(readFileSync(options['--connection'], 'utf8'));
    const result = await uploadAgentArtifact({ baseUrl: connection.baseUrl, episodeId: connection.episodeId, seatToken: connection.seatToken,
      file: options['--file'], kind: options['--kind'], name: options['--name'], mediaType: options['--media-type'],
      ...(options['--metadata'] ? { metadata: JSON.parse(readFileSync(options['--metadata'], 'utf8')) } : {}) });
    if (options['--receipt']) writeFileSync(options['--receipt'], JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) { console.error(error instanceof SyntaxError ? 'Invalid JSON configuration.' : error.message); process.exitCode = 1; }
}
