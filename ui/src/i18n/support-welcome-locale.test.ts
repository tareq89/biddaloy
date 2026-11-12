/** [99.G4.03] Both locales carry the first-login text, and the never-say glossary
 * (docs/ux-research/tenant-control-glossary.md, D14) holds. */
import { describe, expect, it } from 'vitest';

import bn from './locales/bn/supportWelcome.json';
import en from './locales/en/supportWelcome.json';

const NEVER =
  /impersonat|act as|break-glass|consent|session|revoke|kill|\bmode\b|policy|justification|user_id/i;

describe.each([
  ['en', en],
  ['bn', bn],
])('supportWelcome.json (%s)', (_name, tree) => {
  it('has non-empty strings and no never-say word', () => {
    const values = Object.values(tree);
    expect(values.length).toBeGreaterThanOrEqual(8);
    values.forEach((s) => {
      expect(s.trim()).not.toBe('');
      expect(s).not.toMatch(NEVER);
    });
  });
});

it('bn and en have the same keys', () => {
  expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
});
