import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
import { browserGlobals } from './scripts/browser-globals.mjs';
const shared = browserGlobals(new URL('./', import.meta.url));

export default [
  { ignores: ['**/node_modules/**', '**/.pnpm-store/**', 'artifacts/**', 'runtime/**', 'release*/**', 'ios/CoopBench/Resources/Web/**'] },
  { files: ['scripts/**/*.mjs', 'client/**/*.mjs', 'desktop/**/*.mjs', 'web/**/*.js', 'test/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser }, ecmaVersion: 'latest' },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': 'off', 'no-control-regex': 'off', 'no-empty': ['error', { allowEmptyCatch: true }], 'no-constant-condition': ['error', { checkLoops: false }] } },
  // Sanitizers intentionally match ASCII controls. Unused bindings are tracked debt.
  { files: ['web/app.js', 'web/lobby.js', 'web/replay-ui.js', 'web/operator.js', 'desktop/client-smoke.mjs'], languageOptions: { globals: shared } },
  { files: ['**/*.ts'], languageOptions: { parser: ts.parser }, rules: { 'no-undef': 'off', 'no-redeclare': 'off' } },
];
