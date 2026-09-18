import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.length > 1 || args.some(x => x !== '--apply')) throw Error('Use no arguments for read-only preflight, or --apply.');
const apply = args[0] === '--apply';
const files = Object.fromEntries(['nginx-api34935.conf', 'coop-bench-api-proxy.service', 'renew-api34935.sh'].map(name =>
  [name, readFileSync(new URL('../deploy/' + name, import.meta.url)).toString('base64')]));
const payload = Buffer.from(JSON.stringify({ apply, files })).toString('base64');
const python = readFileSync(new URL('../deploy/install-api34935.py', import.meta.url), 'utf8').replace('PAYLOAD_BASE64', JSON.stringify(payload));
const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', 'ubuntu@62.234.160.98', 'sudo -n python3 -'],
  { input: python, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 131072 });
const output = new URL('../artifacts/cloud-api34935-' + (apply ? 'installation' : 'installation-plan') + '.json', import.meta.url);
let report;
try { report = JSON.parse(result.stdout); }
catch { report = { result: 'remote-preflight-or-script-failed', exitCode: result.status, error: result.stderr?.slice(-3000) }; }
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (result.status !== 0) process.exitCode = 1;
