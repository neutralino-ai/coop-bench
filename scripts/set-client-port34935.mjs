// Migrate the inspected, credential-free desktop address only. Never decrypt,
// rebind, discard or overwrite a remembered credential or a custom server URL.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const path = join(process.env.APPDATA, 'Coop Bench Client', 'remote-connection.json');
const beforeText = readFileSync(path, 'utf8'), before = JSON.parse(beforeText);
const apiUrl = 'https://coop.neutrinophysics.cn:34935/api/v1';
assert.equal(before.schema, 'coop-client-connection/v1');
assert.ok(Object.keys(before).every(key => ['schema', 'apiUrl'].includes(key)), 'Saved credential or unknown settings found; no changes made.');
assert.ok(['https://coop.neutrinophysics.cn/api/v1', apiUrl].includes(before.apiUrl), 'A different custom API is configured; no changes made.');
const report = { at: new Date().toISOString(), path, beforeApiUrl: before.apiUrl, apiUrl, credentialReadOrWritten: false, changed: false };
if (before.apiUrl !== apiUrl) {
  const suffix = randomUUID(), backup = path + '.before-34935-' + suffix, temp = path + '.' + suffix + '.tmp';
  writeFileSync(backup, beforeText, { flag: 'wx', mode: 0o600 });
  writeFileSync(temp, JSON.stringify({ schema: before.schema, apiUrl }), { flag: 'wx', mode: 0o600 });
  assert.equal(readFileSync(path, 'utf8'), beforeText, 'Connection settings changed concurrently; original preserved.');
  renameSync(temp, path);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).apiUrl, apiUrl); report.changed = true;
}
writeFileSync(new URL('../artifacts/cloud-api34935-client-address.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
