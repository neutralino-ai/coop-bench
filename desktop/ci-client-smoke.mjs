import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const [executableArgument, dataArgument, expectedArch = process.arch] = process.argv.slice(2);
assert.ok(executableArgument && dataArgument, 'Usage: node desktop/ci-client-smoke.mjs EXECUTABLE TEST_DATA_DIR [ARCH]');
const executable = resolve(executableArgument), dataDir = resolve(dataArgument); mkdirSync(dataDir, { recursive: true });
const development = process.argv.includes('--development');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const child = spawn(executable, [...(development ? [resolve('.')] : []), '--client-smoke-test', `--data-dir=${dataDir}`], { env, windowsHide: true, stdio: 'inherit', shell: false });
// Audit acceptance deliberately uses the production read pacing, across many
// independent replay/export checks. Allow the suite to wait for that budget.
const timeout = setTimeout(() => child.kill(), 240000);
try {
  const { code, signal } = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', (code, signal) => accept({ code, signal })); });
  const report = JSON.parse(readFileSync(resolve(dataDir, 'client-smoke-result.json'), 'utf8'));
  assert.equal(code, 0, `Client exit=${code}, signal=${signal}: ${JSON.stringify(report)}`);
  assert.equal(report.ok, true); assert.equal(report.packaged, !development); assert.equal(report.arch, expectedArch); assert.equal(report.games,1);assert.equal(report.backend,'mock');
  console.log(JSON.stringify(report, null, 2));
} finally { clearTimeout(timeout);  }
