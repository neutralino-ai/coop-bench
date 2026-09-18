import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// No mutation unless --apply is explicit and a matching read-only plan exists.
const args = process.argv.slice(2), values = new Map();
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (values.has(key) || !['--preflight', '--archive', '--apply', '--credential-file'].includes(key)) throw Error('Invalid or duplicate option.');
  if (['--preflight', '--apply'].includes(key)) values.set(key, true);
  else { if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error('Missing option value.'); values.set(key, args[++i]); }
}
const apply = values.has('--apply'), preflight = values.has('--preflight');
if (preflight ? args.length !== 1 : !values.has('--archive') || apply !== values.has('--credential-file'))
  throw Error('Use --preflight, --archive FILE for a read-only plan, or --archive FILE --apply --credential-file PRIVATE_FILE.');
const payload = { apply };
if (!preflight) {
  const archive = resolve(values.get('--archive'));
  if (statSync(archive).size > 8 * 1024 * 1024) throw Error('Release archive exceeds 8 MiB.');
  const bytes = readFileSync(archive);
  payload.archiveBase64 = bytes.toString('base64');
  payload.archiveSha256 = createHash('sha256').update(bytes).digest('hex');
  payload.proxyBase64 = readFileSync(new URL('../deploy/nginx-api34935.conf', import.meta.url)).toString('base64');
}
const planFile = new URL('../artifacts/cloud-auth-upgrade-plan.json', import.meta.url);
if (apply) {
  payload.expectedPlan = JSON.parse(readFileSync(planFile, 'utf8'));
  if (payload.expectedPlan.result !== 'validated-read-only-plan' || payload.expectedPlan.archiveSha256 !== payload.archiveSha256) throw Error('Generate a new read-only plan for this exact archive first.');
  const credentialPath = resolve(values.get('--credential-file'));
  if (statSync(credentialPath).size > 1024) throw Error('Credential file exceeds the expected size.');
  payload.credential = readFileSync(credentialPath, 'utf8').trim();
}
const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
const python = readFileSync(new URL('../deploy/update-cloud-auth.py', import.meta.url), 'utf8').replace('PAYLOAD_BASE64', JSON.stringify(encoded));
const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', 'ubuntu@62.234.160.98', 'sudo -n python3 -'],
  { input: python, encoding: 'utf8', windowsHide: true, timeout: apply ? 240000 : 60000, maxBuffer: 2 * 1024 * 1024 });
let report;
try { report = JSON.parse(result.stdout); }
catch { report = { result: 'remote-transport-or-output-failed', exitCode: result.status, error: 'No valid sanitized report; raw SSH output deliberately omitted. Inspect service state before retrying an uncertain apply.' }; }
const serialized = JSON.stringify(report, null, 2) + '\n';
if (payload.credential && serialized.includes(payload.credential)) throw Error('Refusing output containing verification credential.');
mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true });
const output = apply ? new URL('../artifacts/cloud-auth-upgrade-result.json', import.meta.url) : preflight ? new URL('../artifacts/cloud-auth-upgrade-preflight.json', import.meta.url) : planFile;
writeFileSync(output, serialized);
console.log(serialized);
if (result.status !== 0 || result.error) process.exitCode = 1;
