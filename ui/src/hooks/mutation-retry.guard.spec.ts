import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * [2596] A mutation must never re-send itself: re-sending a write after a lost reply creates the
 * record again. So a mutation's `retry` may only be the literal `false` or absent. This walks the
 * source and fails with `file:line` on any other `retry` (a number, `true`, a function, shorthand)
 * and on a spread, which could carry one in, unless a later `retry: false` overrides it.
 * `useApprovedMutation(fn, options)` takes its options as the second argument.
 */
const OPTIONS_ARG: Record<string, number> = { useMutation: 0, useApprovedMutation: 1 };

function findBanned(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    const index = ts.isCallExpression(node) ? OPTIONS_ARG[node.expression.getText(sf)] : undefined;
    const options = index === undefined ? undefined : (node as ts.CallExpression).arguments[index];
    if (options && ts.isObjectLiteralExpression(options)) {
      const isRetry = (p: ts.ObjectLiteralElementLike): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && p.name.getText(sf) === 'retry';
      const props = options.properties;
      for (const [i, prop] of props.entries()) {
        // A spread is fine only when a later `retry: false` overrides whatever it carried.
        const overridden = props
          .slice(i + 1)
          .some((p) => isRetry(p) && p.initializer.kind === ts.SyntaxKind.FalseKeyword);
        const banned =
          (ts.isSpreadAssignment(prop) && !overridden) ||
          (ts.isShorthandPropertyAssignment(prop) && prop.name.text === 'retry') ||
          (isRetry(prop) && prop.initializer.kind !== ts.SyntaxKind.FalseKeyword);
        if (banned) {
          const { line } = sf.getLineAndCharacterOfPosition(prop.getStart(sf));
          hits.push(`${fileName}:${line + 1}`);
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
  it('no mutation in ui/src or client-admin/src can retry', () => {
    const hits = ['ui/src', 'client-admin/src']
      .flatMap((d) => sourceFiles(path.join(repoRoot, d)))
      .flatMap((f) => findBanned(path.relative(repoRoot, f), readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('flags the banned pattern in a fixture', () => {
    const fixture = `useMutation({\n  mutationFn: f,\n  retry: shouldRetryQuery,\n});`;
    expect(findBanned('fixture.ts', fixture)).toEqual(['fixture.ts:3']);
  });

  it.each([
    'useApprovedMutation(fn, { retry: shouldRetryQuery })',
    'useApprovedMutation(fn, { retry: 3 })',
    'useMutation({ retry: true })',
    'useMutation({ retry: (n, e) => shouldRetryQuery(n, e) })',
    'useMutation({ retry })',
    'useMutation({ mutationFn: f, ...withRetry })',
  ])('flags %s', (source) => {
    expect(findBanned('m.ts', source)).toEqual(['m.ts:1']);
  });

  it('allows retry: false or no retry at all', () => {
    const ok =
      'useMutation({ retry: false }); useApprovedMutation(fn, { onSuccess }); useMutation({});' +
      'useMutation({ ...rest, retry: false });';
    expect(findBanned('ok.ts', ok)).toEqual([]);
  });

  it('leaves a query retry alone', () => {
    expect(findBanned('q.ts', 'useQuery({ retry: shouldRetryQuery });')).toEqual([]);
  });
});
