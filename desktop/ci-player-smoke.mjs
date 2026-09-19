import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const [executable,dataDir,arch=process.arch]=process.argv.slice(2),development=process.argv.includes('--development');
assert.ok(executable&&dataDir);mkdirSync(resolve(dataDir),{recursive:true});const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
const child=spawn(resolve(executable),[...(development?[resolve('desktop/player-main.mjs')]:[]),'--player-smoke-test',`--data-dir=${resolve(dataDir)}`],{env,windowsHide:true,stdio:'inherit',shell:false});
const timer=setTimeout(()=>child.kill(),90000);
try{const code=await new Promise((r,j)=>{child.once('error',j);child.once('close',r);});assert.equal(code,0);
  const report=JSON.parse(readFileSync(resolve(dataDir,'player-smoke-result.json'),'utf8'));assert.equal(report.ok,true);assert.equal(report.arch,arch);assert.equal(report.packaged,!development);console.log(JSON.stringify(report,null,2));
}finally{clearTimeout(timer);}
