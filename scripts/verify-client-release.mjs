import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { sep } from 'node:path';
const require = createRequire(import.meta.url);
const asar = require('../node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/lib/asar.js');
const root = new URL('../', import.meta.url), path = name => fileURLToPath(new URL(name, root));
const archive = path('release/win-unpacked/resources/app.asar');
const allowed = new Set(['package.json', ...['main.mjs', 'preload.cjs', 'local-main.mjs', 'local-preload.cjs', 'remote-session.mjs', 'update-client.mjs', 'client-smoke.mjs', 'ci-smoke.mjs', 'ci-client-smoke.mjs'].map(name => 'desktop/' + name),
  'runtime/coop-bench/src/server.mjs', 'runtime/coop-bench/build-manifest.json', ...['index.html', 'app.js', 'replay-model.js', 'replay-ui.js', 'replay.css', 'transport.js', 'style.css', 'play.html', 'play.js', 'play.css'].map(name => 'runtime/coop-bench/web/' + name)]);
const entry = name => name.replaceAll('/', sep);
const files = asar.listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, '')).filter(name => asar.statFile(archive, entry(name)).size !== undefined).sort();
assert.deepEqual(files, [...allowed].sort(), 'Release archive must contain only reviewed code/static files, no credentials or data.');
const version = JSON.parse(asar.extractFile(archive, 'package.json').toString()).version;
assert.equal(version, JSON.parse(readFileSync(path('package.json'))).version);
for (const name of files.filter(name => name.startsWith('desktop/'))) assert.ok(asar.extractFile(archive, entry(name)).equals(readFileSync(path(name))), 'Packaged desktop code differs: ' + name);
for (const name of files.filter(name => name.startsWith('runtime/'))) assert.ok(asar.extractFile(archive, entry(name)).equals(readFileSync(path(name))), 'Packaged runtime differs: ' + name);
for (const name of files.filter(name => name.startsWith('runtime/coop-bench/web/'))) assert.ok(asar.extractFile(archive, entry(name)).equals(readFileSync(path(name.replace('runtime/coop-bench/', '')))), 'Packaged UI differs from source: ' + name);
const [remoteDir = `artifacts/client-${version}-remote-smoke`, localDir = `artifacts/client-${version}-local-smoke`] = process.argv.slice(2);
const remote = JSON.parse(readFileSync(path(remoteDir + '/client-smoke-result.json')));
const local = JSON.parse(readFileSync(path(localDir + '/desktop-smoke-result.json')));
assert.ok(remote.ok && remote.packaged && remote.version === version && local.ok && local.packaged);
const filename = `Coop-Bench-${version}-win-x64.exe`, installer = path('release/' + filename);
const sha256 = createHash('sha256').update(readFileSync(installer)).digest('hex');
const result = { at: new Date().toISOString(), version, platform: 'win32', arch: 'x64', installer: filename, byteLength: statSync(installer).size, sha256,
  authenticode: 'NotSigned (verified separately with Get-AuthenticodeSignature)', installerWizardExecuted: false, packagedApplicationExecuted: true,
  packagedFiles: files, containsProductionCredentialsOrData: false, remoteChecks: remote.checks, localChecks: local.checks,
  macOS: 'This report verifies the Windows package. Consult docs/release-0.5.0.md and the corresponding native GitHub Actions run for Mac evidence.' };
writeFileSync(path('artifacts/client-release.json'), JSON.stringify(result, null, 2) + '\n');
const sums = path('release/SHA256SUMS.txt'), previous = existsSync(sums) ? readFileSync(sums, 'utf8').trim().split(/\r?\n/).filter(line => line && !line.endsWith(filename)) : [];
writeFileSync(sums, [...previous, `${sha256}  ${filename}`].join('\n') + '\n');
console.log(JSON.stringify({ installer: filename, byteLength: result.byteLength, sha256, packagedFileCount: files.length, remoteChecks: remote.checks.length, localChecks: local.checks.length }));
