import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import asar from '@electron/asar';
import { packageFiles } from './client-files.mjs';

// Works with either client and every native platform's app.asar.
const argument=process.argv[2];
assert.ok(argument,'Usage: node scripts/verify-package.mjs PATH_TO_APP_ASAR');
const root=fileURLToPath(new URL('../',import.meta.url)),archive=resolve(argument);
const actual=asar.listPackage(archive).map(name=>name.replaceAll('\\','/').replace(/^\//,''))
  .filter(name=>asar.statFile(archive,name.split('/').join(sep)).size!==undefined).sort();
assert.deepEqual(actual,[...packageFiles].sort(),'Archive contains files outside the explicit public-client allowlist.');
const extract=name=>asar.extractFile(archive,name.split('/').join(sep));
const pkg=JSON.parse(extract('package.json').toString());
assert.equal(pkg.version,JSON.parse(readFileSync(resolve(root,'package.json'),'utf8')).version);
assert.ok(['desktop/main.mjs','desktop/player-main.mjs'].includes(pkg.main));
for(const name of actual.filter(name=>name!=='package.json')){
  assert.ok(extract(name).equals(readFileSync(resolve(root,name))),'Packaged file differs from validated client output: '+name);
}
const manifest=JSON.parse(extract('runtime/coop-bench/build-manifest.json').toString());
assert.equal(manifest.remoteOnly,true);assert.equal(manifest.containsGameEngine,false);
assert.ok(manifest.inputs.every(name=>name.startsWith('client/')||name==='scripts/agent-message-recorder.mjs'));
const bundle=extract('runtime/coop-bench/client/player.mjs').toString();
for(const forbidden of ['PostgresAuthority','startLocalApp','CREATE TABLE IF NOT EXISTS episodes','src/games/','src/vendor/'])
  assert.ok(!bundle.includes(forbidden),'Backend marker found in public bundle: '+forbidden);
console.log(JSON.stringify({ok:true,version:pkg.version,entry:pkg.main,fileCount:actual.length,
  remoteOnly:true,containsGameEngine:false,sha256:createHash('sha256').update(readFileSync(archive)).digest('hex')},null,2));
