import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Identify a development or release checkout without treating dirty work as released.
 * @param {string} root
 * @returns {{commit:string,tree:string,dirty:boolean}}
 */
export function sourceIdentity(root) {
  /** @param {...string} args */
  const git = (...args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const commit = git('rev-parse', '--verify', 'HEAD');
  const tree = git('rev-parse', 'HEAD^{tree}');
  return { commit, tree, dirty: Boolean(git('status', '--porcelain=v1', '--untracked-files=normal')) };
}

/** Require committed inputs before creating a deployable artifact.
 * @param {string} root
 * @returns {{commit:string,tree:string,dirty:false}}
 */
export function releaseSource(root) {
  const identity = sourceIdentity(root);
  if (identity.dirty) {
    throw Error('Release requires a clean Git checkout, including untracked files. Commit reviewed changes first.');
  }
  return { ...identity, dirty: false };
}

/** Reject a checkout change during packaging.
 * @param {string} root
 * @param {{commit:string,tree:string,dirty:false}} expected
 */
export function verifyReleaseSource(root, expected) {
  const actual = releaseSource(root);
  if (actual.commit !== expected.commit || actual.tree !== expected.tree) throw Error('Release source changed during packaging.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(releaseSource(process.cwd())));
}
