import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sourceBuild } from '../src/authority.ts';

// A separate allowlisted package: never copy a working tree, node_modules,
// credentials, databases, desktop runtime, or the legacy SQLite deployment.
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const args=process.argv.slice(2);
if(args.length!==0&&(args.length!==2||args[0]!=='--out'))throw Error('Usage: node scripts/package-postgres-cloud.mjs [--out NEW_DIRECTORY]');
const source=sourceBuild(),out=resolve(args[1]??join(root,'artifacts',`postgres-cloud-${source.slice(0,12)}-${Date.now()}`));
if(existsSync(out))throw Error('Output directory must be new.');
const stage=join(out,'release');mkdirSync(stage,{recursive:true});
const files=[];
function emit(path,bytes){const target=join(stage,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);files.push(path);}
function copy(path){const input=join(root,path),actual=realpathSync(input),child=relative(root,actual);if(!child||isAbsolute(child)||child==='..'||child.startsWith(`..${sep}`)||!lstatSync(input).isFile())throw Error('Package input must be a regular project file.');emit(path,readFileSync(input));}

// Bundle a library, then use a separate launcher. Bundling an executable directly
// would make imported server.ts's import.meta.url guard start SQLite as well.
const result=await build({absWorkingDir:root,stdin:{contents:`export { startPostgresApp } from './src/postgres-server.ts';
export { readAccessUsers } from './src/access-control.ts';
export { applyPostgresUsers, setPostgresUserDisabled } from './src/postgres-users.ts';
export { default as pg } from 'pg';`,resolveDir:root,sourcefile:'postgres-cloud-library.ts',loader:'ts'},
  bundle:true,write:false,platform:'node',format:'esm',target:'node24',external:['pg-native'],
  banner:{js:"import { createRequire as cloudCreateRequire } from 'node:module'; const require = cloudCreateRequire(import.meta.url);"},
  define:{__COOP_BUILD_ID__:JSON.stringify(source)},logLevel:'silent'});
emit('app/lib/postgres-runtime.mjs',result.outputFiles[0].contents);
emit('app/src/postgres-server.mjs',`import {startPostgresApp,readAccessUsers} from '../lib/postgres-runtime.mjs';
startPostgresApp({databaseUrl:process.env.COOP_DATABASE_URL??'',adminToken:process.env.COOP_ADMIN_TOKEN??'',port:Number(process.env.PORT??8789),
  ...(process.env.COOP_USERS_FILE?{users:readAccessUsers(process.env.COOP_USERS_FILE).users}:{}),trustedProxyOrigin:process.env.COOP_TRUSTED_PROXY_ORIGIN,serveWeb:false})
  .then(server=>{console.log('Coop Bench PostgreSQL API: '+server.apiUrl+'\\nListener: loopback only. Credentials and database URL are not logged.');const stop=()=>void server.close().then(()=>process.exit(0));process.once('SIGINT',stop);process.once('SIGTERM',stop);})
  .catch(()=>{console.error('PostgreSQL server failed to start. Check database availability, configuration and pinned schema/build.');process.exitCode=1;});
`);
emit('app/scripts/postgres-users.mjs',`import {pg,readAccessUsers,applyPostgresUsers,setPostgresUserDisabled} from '../lib/postgres-runtime.mjs';
const [operation,value]=process.argv.slice(2);
if(!process.env.COOP_DATABASE_URL||!['apply-file','disable','enable'].includes(operation)||!value){console.error('Set COOP_DATABASE_URL. Usage: postgres-users.mjs apply-file <users-file> | disable <id> | enable <id>');process.exitCode=1;}
else{const pool=new pg.Pool({connectionString:process.env.COOP_DATABASE_URL,max:1});try{console.log(JSON.stringify(operation==='apply-file'?await applyPostgresUsers(pool,readAccessUsers(value).users):await setPostgresUserDisabled(pool,value,operation==='disable')));}catch{console.error('User update failed. No credential values are logged.');process.exitCode=1;}finally{await pool.end();}}
`);
for(const name of ['coop-bench-v09.service','coop-bench-v09-proxy.service','coop-bench-v09-backup.service','coop-bench-v09-backup.timer','server.env.example','nginx-api34936.conf','backup-postgres.sh','renew-api34936.sh'])copy(`deploy/postgres/${name}`);
copy('docs/stateless-server.md');
emit('app/build-manifest.json',JSON.stringify({schema:'coop-bench-build/v1',sourceBuild:source,entry:'src/postgres-server.mjs',backend:'postgresql',includesTakeTime:true},null,2)+'\n');
const manifest={schema:'coop-bench-postgres-cloud-release/v1',sourceBuild:source,createdAt:new Date().toISOString(),node:'24.21.0+',entry:'app/src/postgres-server.mjs',containsData:false,containsCredentials:false,
  files:files.sort().map(path=>{const bytes=readFileSync(join(stage,path));return {path,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};})};
emit('release-manifest.json',JSON.stringify(manifest,null,2)+'\n');
const archive=join(out,`coop-bench-postgres-${source.slice(0,12)}.tar.gz`);
const packed=spawnSync('tar',['-czf',archive,'-C',stage,...files],{encoding:'utf8'});
if(packed.error||packed.status!==0)throw Error(`tar packaging failed: ${packed.error?.message??packed.stderr}`);
const listing=spawnSync('tar',['-tzf',archive],{encoding:'utf8'});
if(listing.error||listing.status!==0||JSON.stringify(listing.stdout.trim().split(/\r?\n/).sort())!==JSON.stringify([...files].sort()))throw Error('Archive file listing mismatch.');
const sha256=createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(archive+'.sha256',`${sha256}  ${archive.split(/[\\/]/).at(-1)}\n`);
console.log(JSON.stringify({archive,sha256,fileCount:files.length,sourceBuild:source,containsData:false,containsCredentials:false},null,2));
