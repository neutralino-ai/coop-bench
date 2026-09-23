import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

test('repository policy rejects leaked files, broken requirements and weaker type checks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coop-policy-'));
  const put = (name:string,value:unknown) => writeFileSync(join(dir,name),typeof value==='string'?value:JSON.stringify(value));
  const run = () => spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/check-repository.mjs',import.meta.url))],{cwd:dir,encoding:'utf8'});
  try {
    execFileSync('git',['init','-q'],{cwd:dir,stdio:'pipe'});
    put('quality-policy.json',{publicClient:true,typedEntrypoints:['client/**/*.ts'],legacyAny:{}});
    put('package.json',{packageManager:'pnpm@11.19.0'});
    put('tsconfig.json',{compilerOptions:{strict:true,noEmit:true},include:['client/**/*.ts']});
    assert.equal(run().status,0);
    mkdirSync(join(dir,'client'));put('client/new.ts','export const value: any = 1;');
    assert.match(run().stderr,/explicit any increased/);
    put('client/new.ts','export const value: number = 1;');
    mkdirSync(join(dir,'docs/prds'),{recursive:true});put('docs/prds/feature.md','Status: maybe\n[missing](missing.md)');
    assert.match(run().stderr,/invalid PRD lifecycle/);
    assert.match(run().stderr,/broken local link/);
    rmSync(join(dir,'docs/prds/feature.md'));
    put('credential.pem','synthetic private file');
    assert.match(run().stderr,/private file must not be tracked/);
    rmSync(join(dir,'credential.pem'));
    mkdirSync(join(dir,'src'));put('src/server.ts','export {};');
    assert.match(run().stderr,/outside the public client boundary/);
    rmSync(join(dir,'src/server.ts'));
    put('tsconfig.json',{compilerOptions:{strict:false,noEmit:true},include:['client/**/*.ts']});
    assert.match(run().stderr,/Strict, no-emit/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
