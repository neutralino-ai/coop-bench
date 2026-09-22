// Recover publication without moving a tag or rebuilding validated native apps.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
const repo=process.env.GITHUB_REPOSITORY,run=process.env.SOURCE_RUN,tag=process.env.RELEASE_TAG;
if(repo!=='neutralino-ai/coop-bench'||!/^\d+$/.test(run??'')||!/^v\d+\.\d+\.\d+$/.test(tag??''))throw Error('Invalid publication source');
const version=tag.slice(1),notes=`docs/release-${version}.md`;
readFileSync(notes); // Require release notes before uploading any file.
function gh(...args){const r=spawnSync('gh',args,{encoding:'utf8',maxBuffer:16*1024*1024});if(r.status!==0)throw Error(r.stderr||'GitHub command failed');return r.stdout;}
const api=path=>JSON.parse(gh('api',`repos/${repo}/${path}`));
const source=api(`actions/runs/${run}`),workflow=api('actions/workflows/desktop-build.yml');
let ref=api(`git/ref/tags/${tag}`).object;
if(ref.type==='tag')ref=api(`git/tags/${ref.sha}`).object;
if(ref.type!=='commit'||source.head_sha!==ref.sha||source.workflow_id!==workflow.id||source.event!=='push'||source.head_branch!==tag||source.status!=='completed')throw Error('Run must be the completed tag build from Remote clients');
const jobs=api(`actions/runs/${run}/jobs?filter=latest&per_page=100`);
if(jobs.total_count>100)throw Error('Unexpected job pagination');
const latest=new Map();for(const job of jobs.jobs)if(!latest.has(job.name)||latest.get(job.name).id<job.id)latest.set(job.name,job);
for(const name of ['Windows x64','macOS Intel','macOS Apple Silicon','iOS native and simulator acceptance / ios','Upload verified iOS build to TestFlight']){
 const job=latest.get(name);if(job?.status!=='completed'||job.conclusion!=='success')throw Error(`Required check did not pass: ${name}`);
}
console.log(`Verified ${tag} at ${ref.sha}: all native and TestFlight checks passed in run ${run}.`);
if(process.argv[2]==='check')process.exit(0);
if(process.argv[2]!=='publish')throw Error('Expected check or publish');
const entries=['release','release-player'].flatMap(dir=>['win-x64.exe','mac-x64.dmg','mac-arm64.dmg','mac-x64.zip','mac-arm64.zip'].map(s=>({dir,name:`Coop-Bench-${dir==='release-player'?'Player-':''}${version}-${s}`})));
entries.push({dir:'ios',name:`Coop-Bench-${version}-iOS-Xcode.zip`});
const assets=entries.map(({dir,name})=>{const path=`dist/${dir}/${name}`,size=statSync(path).size;if(size<1000)throw Error(`Invalid asset ${name}`);return {name,path,size,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')};});
const checksum='dist/release/SHA256SUMS.txt';writeFileSync(checksum,assets.map(a=>`${a.sha256}  ${a.name}`).join('\n')+'\n');
assets.push({name:'SHA256SUMS.txt',path:checksum,size:statSync(checksum).size,sha256:createHash('sha256').update(readFileSync(checksum)).digest('hex')});
let release=JSON.parse(gh('release','view',tag,'--repo',repo,'--json','isDraft,assets,tagName'));
if(!release.isDraft||release.tagName!==tag)throw Error('Recovery requires the existing draft for this tag');
if(release.assets.some(a=>!assets.some(expected=>a.name===expected.name)))throw Error('Draft contains unrelated assets');
gh('release','upload',tag,...assets.map(a=>a.path),'--repo',repo,'--clobber');
release=api(`releases/tags/${tag}`);
if(!release.draft||release.assets.length!==assets.length)throw Error('Incomplete draft');
for(const expected of assets){const actual=release.assets.find(a=>a.name===expected.name);if(!actual||actual.state!=='uploaded'||actual.size!==expected.size||actual.digest&&actual.digest!==`sha256:${expected.sha256}`)throw Error(`Uploaded asset mismatch: ${expected.name}`);}
gh('release','edit',tag,'--repo',repo,'--notes-file',notes,'--draft=false','--latest');
console.log(JSON.stringify({url:release.html_url,tag,sourceRun:run,commit:ref.sha,assets:assets.map(({name,size,sha256})=>({name,size,sha256}))},null,2));
