import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';

// The development Electron binary and the signed app have different keychain
// access requirements. Give each acceptance run an empty temporary keychain so
// it tests real safeStorage without reusing the other binary's synthetic item.
if(process.platform!=='darwin'||process.env.GITHUB_ACTIONS!=='true'||!process.env.RUNNER_TEMP)throw Error('Only for ephemeral macOS CI');
const [script,...args]=process.argv.slice(2);
if(!['desktop/ci-client-smoke.mjs','desktop/ci-player-smoke.mjs'].includes(script))throw Error('Unsupported acceptance script');
function security(args){const r=spawnSync('security',args,{encoding:'utf8'});if(r.status!==0)throw Error(`Test keychain operation failed: ${r.stderr}`);return r.stdout;}
const originalList=[...security(['list-keychains','-d','user']).matchAll(/"([^"]+)"/g)].map(m=>m[1]);
const originalDefault=security(['default-keychain','-d','user']).trim().replace(/^"|"$/g,'');
const temp=mkdtempSync(join(process.env.RUNNER_TEMP,'coop-acceptance-'));
const keychain=join(temp,'acceptance.keychain-db'),password=randomBytes(32).toString('hex');
let code=1;
try{
 security(['create-keychain','-p',password,keychain]);
 security(['set-keychain-settings','-lut','600',keychain]);
 security(['unlock-keychain','-p',password,keychain]);
 security(['list-keychains','-d','user','-s',keychain]);
 security(['default-keychain','-d','user','-s',keychain]);
 const r=spawnSync(process.execPath,[script,...args],{stdio:'inherit',timeout:150000,killSignal:'SIGKILL'});
 code=r.status??1;
}finally{
 try{security(['default-keychain','-d','user','-s',originalDefault]);}
 finally{
  try{security(['list-keychains','-d','user','-s',...originalList]);}
  finally{security(['delete-keychain',keychain]);rmSync(temp,{recursive:true,force:true});}
 }
}
process.exitCode=code;
