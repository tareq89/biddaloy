/** [100.4.02] Both locales carry the SMS package text, and the glossary's never-say words (D15) hold. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import bn from '../../../../ui/src/i18n/locales/bn/smsBundles.json';
import en from '../../../../ui/src/i18n/locales/en/smsBundles.json';

/** The glossary's "Never say" column, every comma-separated entry. */
function neverWords(): string[] {
  const doc = readFileSync(
    resolve(__dirname, '../../../../docs/ux-research/cockpit-money-glossary.md'),
    'utf8',
  );
  return doc
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|[\s-|]+\|$/.test(l))
    .slice(1)
    .flatMap((l) => (l.split('|')[3] ?? '').split(','))
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w !== '' && w !== 'never say');
}

function strings(tree: unknown): string[] {
  if (typeof tree === 'string') return [tree];
  return Object.values(tree as Record<string, unknown>).flatMap(strings);
}

function keys(tree: unknown, prefix = ''): string[] {
  if (typeof tree === 'string') return [prefix];
  return Object.entries(tree as Record<string, unknown>).flatMap(([k, v]) =>
    keys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('smsBundles.json', () => {
  const words = neverWords();

  it('reads the never-say words from the glossary', () => {
    expect(words).toEqual(expect.arrayContaining(['bundle', 'lot', 'ledger', 'allocation']));
  });

  it('has the same keys in bn and en', () => {
    expect(keys(bn).sort()).toEqual(keys(en).sort());
  });

  it.each([
    ['en', en],
    ['bn', bn],
  ] as const)('%s uses no never-say word, nor "masked" on its own', (_n, tree) => {
    for (const text of strings(tree)) {
      for (const word of [...words, 'masked']) {
        // "unmasked" and the glossary's "আনমাস্কড" are the allowed words.
        const cleaned = text.toLowerCase().replace(/unmasked/g, '');
        expect(cleaned, `"${text}" contains "${word}"`).not.toMatch(
          new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
        );
      }
    }
  });
});
