import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * [2596] A mutation must never carry `retry: shouldRetryQuery`: re-sending a write after a lost
 * reply creates the record again. Only a request with an Idempotency-Key may opt in with its own
 * `retry`. This walks the source and fails with `file:line` on the banned shape.
 */
const MUTATION_HOOKS = new Set(['useMutation', 'useApprovedMutation']);

function findBanned(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && MUTATION_HOOKS.has(node.expression.getText(sf))) {
      const options = node.arguments[0];
      if (options && ts.isObjectLiteralExpression(options)) {
        for (const prop of options.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            prop.name.getText(sf) === 'retry' &&
            prop.initializer.getText(sf) === 'shouldRetryQuery'
          ) {
            const { line } = sf.getLineAndCharacterOfPosition(prop.getStart(sf));
            hits.push(`${fileName}:${line + 1}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

const repoRoot = path.resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !f.endsWith('.d.ts'))
    .map((f) => path.join(dir, f));
}

describe('mutation retry guard', () => {
  it('no useMutation in ui/src or client-admin/src retries with shouldRetryQuery', () => {
    const hits = ['ui/src', 'client-admin/src']
      .flatMap((d) => sourceFiles(path.join(repoRoot, d)))
      .flatMap((f) => findBanned(path.relative(repoRoot, f), readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('flags the banned pattern in a fixture', () => {
    const fixture = `useMutation({\n  mutationFn: f,\n  retry: shouldRetryQuery,\n});`;
    expect(findBanned('fixture.ts', fixture)).toEqual(['fixture.ts:3']);
  });

  it('leaves a query retry alone', () => {
    expect(findBanned('q.ts', 'useQuery({ retry: shouldRetryQuery });')).toEqual([]);
  });
});
