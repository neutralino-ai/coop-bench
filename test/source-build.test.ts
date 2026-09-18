import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { sourceBuild } from '../src/authority.ts';

test('standalone vendored files retain their recorded source bytes', () => {
  const lineage = JSON.parse(readFileSync(new URL('../docs/vendor-lineage.json', import.meta.url), 'utf8'));
  for (const entry of lineage.entries) {
    const bytes = readFileSync(new URL('../' + entry.target, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.target);
  }
});

test('build identity works without sibling projects, ignores checkout EOL, and includes vendored engine changes', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'coop-standalone-source-'));
  t.after(() => {
    assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
    rmSync(temporary, { recursive: true, force: true });
  });
  cpSync(new URL('../src/', import.meta.url), join(temporary, 'src'), { recursive: true });
  writeFileSync(join(temporary, 'package.json'), '{"type":"module"}\n');
  const moduleUrl = pathToFileURL(join(temporary, 'src', 'authority.ts')).href;
  // Model only the OS filesystem boundary in a separate process. Both styles
  // address the same real files; the production fingerprint stays unmodified.
  const copiedBuild = (separator?: '/' | '\\') => execFileSync(process.execPath, ['--input-type=module', '-e',
    `import fs from 'node:fs';import { syncBuiltinESMExports } from 'node:module';
     const separator=${JSON.stringify(separator ?? null)};
     if(separator){const list=fs.readdirSync,read=fs.readFileSync;
       fs.readdirSync=(...args)=>list(...args).map(name=>typeof name==='string'?name.replaceAll('\\\\','/').replaceAll('/',separator):name);
       fs.readFileSync=(name,...args)=>read(typeof name==='string'?name.replaceAll('\\\\','/'):name,...args);
       syncBuiltinESMExports();}
     const { sourceBuild }=await import(${JSON.stringify(moduleUrl)});process.stdout.write(sourceBuild());`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: temporary }).trim();
  const original = sourceBuild();
  assert.equal(copiedBuild(), original, 'a standalone source tree must have the same build');
  assert.equal(copiedBuild('/'), original, 'POSIX recursive path separators preserve build identity');
  assert.equal(copiedBuild('\\'), original, 'Windows recursive path separators preserve build identity');
  for (const name of readdirSync(join(temporary, 'src'), { recursive: true }).filter(name => name.endsWith('.ts'))) {
    const path = join(temporary, 'src', name);
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'));
  }
  assert.equal(copiedBuild(), original, 'Windows CRLF and LF checkouts are equivalent');
  const engine = join(temporary, 'src', 'vendor', 'take-time', 'engine.ts');
  writeFileSync(engine, readFileSync(engine, 'utf8') + '\r\n// Synthetic fingerprint change.\r\n');
  assert.notEqual(copiedBuild(), original, 'vendored engine changes must invalidate replay identity');
});
