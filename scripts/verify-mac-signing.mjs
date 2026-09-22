import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
if(process.platform!=='darwin')throw Error('Requires macOS');
const team=process.env.APPLE_TEAM_ID;
if(!team)throw Error('Missing Apple team');
function run(cmd,args){const r=spawnSync(cmd,args,{encoding:'utf8'});if(r.status!==0)throw Error(`${cmd}: ${r.stdout}\n${r.stderr}`);return r.stdout+'\n'+r.stderr;}
const results=[];
for(const dir of ['release','release-player']){
 for(const name of readdirSync(dir).filter(n=>n.endsWith('.zip'))){
  const temp=mkdtempSync(join(process.env.RUNNER_TEMP||tmpdir(),'coop-verify-'));
  try{
   run('ditto',['-x','-k',join(dir,name),temp]);
   const apps=readdirSync(temp).filter(n=>n.endsWith('.app'));
   if(apps.length!==1)throw Error('Expected one application in '+name);
   const app=join(temp,apps[0]);
   run('codesign',['--verify','--deep','--strict','--verbose=2',app]);
   const detail=run('codesign',['--display','--verbose=4',app]);
   if(!detail.includes('TeamIdentifier='+team)||!detail.includes('Authority=Developer ID Application:')||!detail.includes('runtime'))throw Error('Unexpected signing identity or missing hardened runtime');
   run('xcrun',['stapler','validate',app]);
   const assessment=run('spctl',['--assess','--type','execute','--verbose=4',app]);
   results.push({file:name,signature:detail,gatekeeper:assessment});
  }finally{rmSync(temp,{recursive:true,force:true});}
 }
 for(const name of readdirSync(dir).filter(n=>n.endsWith('.dmg'))){
  run('xcrun',['stapler','validate',join(dir,name)]);
  results.push({file:name,gatekeeper:run('spctl',['--assess','--type','open','--context','context:primary-signature','--verbose=4',join(dir,name)])});
 }
}
if(results.length!==4)throw Error('Expected management and player ZIP/DMG');
mkdirSync('artifacts/apple-signing',{recursive:true});
writeFileSync('artifacts/apple-signing/verification.json',JSON.stringify({ok:true,team,results},null,2));
console.log('Both packaged apps and DMGs passed signing, notarization and Gatekeeper checks');
