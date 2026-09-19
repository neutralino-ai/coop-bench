import { build } from 'esbuild';
import { mkdir, cp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sourceBuild } from '../src/authority.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=new URL('../runtime/coop-bench/',import.meta.url);
const fingerprint=sourceBuild();
await mkdir(new URL('src/',output),{recursive:true});
await build({absWorkingDir:root,entryPoints:['src/server.ts'],bundle:true,platform:'node',format:'esm',target:'node24',
  outfile:fileURLToPath(new URL('src/server.mjs',output)),
  define:{__COOP_BUILD_ID__:JSON.stringify(fingerprint)},logLevel:'info'});
await cp(new URL('../web/',import.meta.url),new URL('web/',output),{recursive:true});
await build({absWorkingDir:root,entryPoints:['client/index.mjs'],bundle:true,platform:'node',format:'esm',target:'node24',
  outfile:fileURLToPath(new URL('client/player.mjs',output)),logLevel:'info'});
await writeFile(new URL('build-manifest.json',output),JSON.stringify({schema:'coop-bench-build/v1',sourceBuild:fingerprint,
  entry:'src/server.mjs',includesTakeTime:true},null,2)+'\n');
console.log(`Desktop runtime ready: ${fingerprint.slice(0,12)} (all 10 game engines included)`);
