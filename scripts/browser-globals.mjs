import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Classic scripts share one lexical scope in index.html. Derive declarations,
// not lint failures, so an accidental undefined name still fails the check.
export function browserGlobals(root) {
  const html = readFileSync(new URL('web/index.html', root), 'utf8');
  const names = new Set();
  const binding = node => {
    if (ts.isIdentifier(node)) names.add(node.text);
    else for (const element of node.elements ?? []) if (element.name) binding(element.name);
  };
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']\/?([^"']+)["'][^>]*>/g)) {
    const source = ts.createSourceFile(match[1], readFileSync(new URL('web/' + match[1], root), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    for (const node of source.statements) {
      if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) binding(declaration.name);
      else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) names.add(node.name.text);
    }
  }
  return Object.fromEntries([...names].map(name => [name, 'readonly']));
}
