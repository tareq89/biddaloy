/** [99.G4.04] Both locales carry the support access text, and the never-say glossary
 * (docs/ux-research/tenant-control-glossary.md, D14) holds. The words are read from the
 * glossary file, so a word added there is enforced here. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import bn from './locales/bn/supportAccess.json';
import en from './locales/en/supportAccess.json';

/** The glossary's "Never say" column plus its "Also never say" line, one-word entries and
 * every phrase (a phrase is matched whole, so none can slip past a word filter). */
function neverWords(): string[] {
  const doc = readFileSync(
    resolve(__dirname, '../../../docs/ux-research/tenant-control-glossary.md'),
    'utf8',
  );
  const column = doc
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|[\s-|]+\|$/.test(l))
    .slice(1)
    .map((l) => l.split('|')[3] ?? '')
    .flatMap((c) => c.split(','));
  const also = /Also never say:\s*\*\*(.+?)\*\*/.exec(doc)?.[1]?.split(',') ?? [];
  // D14 words the glossary table does not spell out (the ticket's acceptance list).
  const d14 = ['mode', 'policy', 'justification', 'kill', 'user_id'];
  return [...column, ...also, ...d14].map((w) => w.trim().toLowerCase()).filter((w) => w !== '');
}

describe('supportAccess.json', () => {
  it('reads a real never-say list from the glossary', () => {
    const words = neverWords();
    for (const w of [
      'impersonate',
      'consent',
      'revoke',
      'break-glass',
      'act as',
      'session',
      'log out',
      'no user',
      'expires in',
    ]) {
      expect(words).toContain(w);
    }
  });

  describe.each([
    ['en', en],
    ['bn', bn],
  ])('(%s)', (_name, tree) => {
    it('has non-empty strings and no never-say word', () => {
      const values = Object.values(tree);
      expect(values.length).toBeGreaterThanOrEqual(40);
      const words = neverWords();
      values.forEach((s) => {
        expect(s.trim()).not.toBe('');
        words.forEach((w) =>
          expect(s.toLowerCase(), `"${w}" in "${s}"`).not.toMatch(
            new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
          ),
        );
      });
    });
  });

  it('bn and en have the same keys', () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
  });
});
