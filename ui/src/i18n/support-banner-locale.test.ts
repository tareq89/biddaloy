/** [99.G4.01] Both locales carry the intake text, and the never-say glossary
 * (docs/ux-research/tenant-control-glossary.md, D14) holds. */
import { describe, expect, it } from 'vitest';

import bn from './locales/bn/supportBanner.json';
import en from './locales/en/supportBanner.json';

const NEVER =
  /impersonat|act as|break-glass|consent|session|revoke|kill|\bmode\b|policy|justification|user_id/i;

function leaves(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  return Object.values(node as Record<string, unknown>).flatMap(leaves);
}

describe.each([
  ['en', en],
  ['bn', bn],
])('supportBanner.json (%s)', (_name, tree) => {
  it('has non-empty intake strings', () => {
    expect(leaves(tree).length).toBeGreaterThanOrEqual(4);
    leaves(tree).forEach((s) => expect(s.trim()).not.toBe(''));
  });

  it('uses no never-say word', () => {
    leaves(tree).forEach((s) => expect(s).not.toMatch(NEVER));
  });
});

it('bn and en have the same keys', () => {
  expect(Object.keys(bn.intake).sort()).toEqual(Object.keys(en.intake).sort());
});
