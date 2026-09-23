import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const policy = JSON.parse(readFileSync('quality-policy.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const errors = [];
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || major === 24 && minor < 21) errors.push('Node 24.21.0 or newer is required.');
if (pkg.packageManager !== 'pnpm@11.19.0') errors.push('Update the documented toolchain and CI together before changing pnpm.');
const config = JSON.parse(readFileSync('tsconfig.json', 'utf8'));
if (!config.compilerOptions.strict || !config.compilerOptions.noEmit) errors.push('Strict, no-emit type checking is required.');
if (JSON.stringify(config.include) !== JSON.stringify(policy.typedEntrypoints)) errors.push('Type coverage differs from the reviewed policy.');
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
const secretPatterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\b(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_]{20,}/, /\bAKIA[A-Z0-9]{16}\b/];
for (const file of files) {
  if (!existsSync(file)) continue;
  if (/\.(?:pem|key|p12|p8|sqlite|db)$|(?:^|\/)\.env$/.test(file)) errors.push(`${file}: private file must not be tracked.`);
  if (policy.publicClient && /^(?:src|deploy|data|private|player-records|evidence)\//.test(file)) errors.push(`${file}: outside the public client boundary.`);
  if (!/\.(?:[cm]?js|ts|json|md|ya?ml|sh|swift|conf)$/.test(file)) continue;
  const source = readFileSync(file, 'utf8');
  if (secretPatterns.some(pattern => pattern.test(source))) errors.push(`${file}: potential credential; inspect privately.`);
  if (file.endsWith('AGENTS.md') && source.split(/\r?\n/).length > 110) errors.push(`${file}: keep standing instructions below 110 lines; link procedures and history.`);
  if (file === 'CLAUDE.md' && (!source.includes('AGENTS.md') || source.split(/\r?\n/).length > 12)) errors.push('CLAUDE.md must be a short pointer to AGENTS.md.');
  if (/^(?:docs\/(?:engineering|prds|decisions)\/|AGENTS\.md$|CLAUDE\.md$)/.test(file) && file.endsWith('.md')) {
    for (const match of source.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const link = match[1].split('#')[0];
      if (link && !/^(?:[a-z]+:|\/)/i.test(link) && !existsSync(resolve(dirname(file), decodeURIComponent(link)))) errors.push(`${file}: broken local link ${link}`);
    }
  }
  if (/^docs\/prds\/.+\.md$/.test(file) && !file.endsWith('README.md')) {
    if (!/^Status: (proposed|in-progress|implemented|rejected)$/m.test(source)) errors.push(`${file}: invalid PRD lifecycle.`);
    for (const heading of ['Problem', 'Scope', 'Acceptance criteria', 'Validation', 'Rollout and rollback']) if (!source.includes('## ' + heading)) errors.push(`${file}: missing ${heading}.`);
  }
  if (/^(?:src|client|desktop|web|scripts)\//.test(file) && /\.(?:ts|[cm]?js)$/.test(file)) {
    if (/@ts-(?:ignore|nocheck)/.test(source)) errors.push(`${file}: use typed boundaries instead of disabling type checks.`);
    if (file.endsWith('.ts') && !file.startsWith('src/vendor/')) {
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      let count = 0;const visit = node => { if (node.kind === ts.SyntaxKind.AnyKeyword) count++;ts.forEachChild(node, visit); };visit(tree);
      if (count > (policy.legacyAny[file] ?? 0)) errors.push(`${file}: explicit any increased (${count}); narrow the boundary or review a migration plan.`);
    }
  }
}
if (errors.length) { console.error(errors.join('\n'));process.exitCode = 1; }
else console.log(`Repository policy passed: ${files.length} files; strict type scope and legacy any budgets checked.`);
