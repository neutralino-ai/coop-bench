import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const [executableArgument, dataArgument, expectedArch = process.arch] = process.argv.slice(2);
assert.ok(executableArgument && dataArgument, 'Usage: node desktop/ci-smoke.mjs EXECUTABLE TEST_DATA_DIR [ARCH]');
const executable = resolve(executableArgument), dataDir = resolve(dataArgument);
mkdirSync(dataDir, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const child = spawn(executable, ['--smoke-test', `--data-dir=${dataDir}`], {
  env, windowsHide: true, stdio: 'inherit', shell: false,
});
const timeout = setTimeout(() => child.kill(), 90_000);
try {
  const { code, signal } = await new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => accept({ code, signal }));
  });
  assert.equal(code, 0, `Packaged application failed: exit=${code}, signal=${signal}`);
  const report = JSON.parse(readFileSync(resolve(dataDir, 'desktop-smoke-result.json'), 'utf8'));
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.packaged, true);
  assert.equal(report.arch, expectedArch);
  assert.equal(report.games, 10);
  assert.ok(report.checks.includes('bundled-take-time-engine'));
  assert.ok(report.checks.includes('replay'));
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearTimeout(timeout);
}
