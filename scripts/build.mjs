import { build } from 'esbuild';
import { mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { webFiles } from './client-files.mjs';
import { sourceIdentity } from './release-source.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(root,'runtime','coop-bench');
// Clean only the fixed generated client directory; stale old engine bundles
// must not survive a rebuild or enter an archive through a later glob.
if(relative(root,output)!==['runtime','coop-bench'].join(sep))throw Error('Unsafe client output directory.');
await rm(output,{recursive:true,force:true});
await mkdir(resolve(output,'client'),{recursive:true});
await mkdir(resolve(output,'web'),{recursive:true});
const bundled=await build({absWorkingDir:root,entryPoints:['client/index.mjs'],bundle:true,platform:'node',
  format:'esm',target:'node24',outfile:resolve(output,'client/player.mjs'),metafile:true,logLevel:'info'});
const inputs=Object.keys(bundled.metafile.inputs).sort();
if(inputs.some(name=>!name.startsWith('client/')&&name!=='scripts/agent-message-recorder.mjs'))throw Error('Unexpected dependency outside the public client boundary.');
const digest=createHash('sha256');
for(const name of [...inputs,...webFiles.map(name=>'web/'+name)].sort()){
  const bytes=await readFile(resolve(root,name));digest.update(name+'\0').update(bytes);
}
for(const name of webFiles)await copyFile(resolve(root,'web',name),resolve(output,'web',name));
const version=JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).version;
const manifest={schema:'coop-bench-client-build/v1',version,clientBuild:digest.digest('hex'),sourceRevision:sourceIdentity(root),
  remoteOnly:true,containsGameEngine:false,entry:'client/player.mjs',inputs};
await writeFile(resolve(output,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Remote client runtime ${version}: ${manifest.clientBuild.slice(0,12)} (no game engine)`);
