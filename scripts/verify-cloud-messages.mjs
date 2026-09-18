import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const credential = readFileSync(new URL('../artifacts/cloud-private/owner.txt', import.meta.url), 'utf8').trim();
const result = spawnSync('ssh', ['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','ubuntu@62.234.160.98',
  '/opt/coop-bench-node/bin/node /home/ubuntu/coop-bench-stage-messages/verify-messages-api.mjs'],
  {cwd:root,input:credential+'\n',encoding:'utf8',timeout:60000,maxBuffer:128*1024});
if (result.error || result.status!==0) throw Error('Cloud normal read verification failed; credential was not logged.');
const report = JSON.parse(result.stdout);
if (!report.ok) throw Error('Cloud verification did not pass.');
writeFileSync(new URL('../artifacts/artifact-release/cloud-messages-api.json', import.meta.url), JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
