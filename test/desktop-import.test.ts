import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('embedded server import does not treat packaged Electron flags as an entrypoint file', () => {
  const source = new URL('../src/server.ts', import.meta.url).href;
  for (const argument of ['--local', '--smoke-test', '--client-smoke-test', 'missing-electron-entrypoint']) {
    const script = `process.argv[1] = ${JSON.stringify(argument)}; await import(${JSON.stringify(source)}); console.log('imported-without-listening');`;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /imported-without-listening/);
  }
});
