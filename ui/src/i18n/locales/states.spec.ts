/** [3329 / 4287] states.* has the same keys in both languages and no D11 never-say term. */
import { describe, expect, it } from 'vitest';

import bn from './bn/states.json';
import en from './en/states.json';

const NEVER = /network error|latency|timeout|token|\b401\b|\b403\b|\bnull\b|forbidden/i;

function paths(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    paths(v, prefix ? `${prefix}.${k}` : k),
  );
}
function leaves(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  return Object.values(node as Record<string, unknown>).flatMap(leaves);
}

describe('states.json', () => {
  it('en and bn have the same keys', () => {
    expect(paths(bn).sort()).toEqual(paths(en).sort());
  });

  it.each([
    ['en', en],
    ['bn', bn],
  ])('%s: strings are non-empty and use no never-say term', (_n, tree) => {
    leaves(tree).forEach((s) => {
      expect(s.trim()).not.toBe('');
      expect(s).not.toMatch(NEVER);
    });
  });
});
