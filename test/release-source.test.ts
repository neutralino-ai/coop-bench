import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { releaseSource, verifyReleaseSource } from '../scripts/release-source.mjs';

test('release source rejects unstaged, staged, untracked and changed commits; ignored evidence is allowed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coop-release-source-'));
  const git = (...args:string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  const commit = () => git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  try {
    git('init', '-q');
    writeFileSync(join(dir, '.gitignore'), 'evidence.log\n');
    writeFileSync(join(dir, 'source.txt'), 'original\n');
    git('add', '.');commit();
    const source = releaseSource(dir);
    assert.match(source.commit, /^[a-f0-9]{40,64}$/);
    writeFileSync(join(dir, 'evidence.log'), 'local only');
    verifyReleaseSource(dir, source);
    writeFileSync(join(dir, 'source.txt'), 'changed\n');
    assert.throws(() => releaseSource(dir), /clean Git checkout/);
    git('add', 'source.txt');
    assert.throws(() => releaseSource(dir), /clean Git checkout/);
    commit();
    assert.throws(() => verifyReleaseSource(dir, source), /changed during packaging/);
    writeFileSync(join(dir, 'forgotten-source.txt'), 'untracked');
    assert.throws(() => releaseSource(dir), /clean Git checkout/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
