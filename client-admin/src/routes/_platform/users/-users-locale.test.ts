import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import bn from '../../../../../ui/src/i18n/locales/bn/platformUsers.json';
import en from '../../../../../ui/src/i18n/locales/en/platformUsers.json';

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Object.values(v as object).flatMap(strings);

// Never-say words come from the glossary file itself (column 3), plus the ticket's list.
const glossary = readFileSync(
  join(__dirname, '../../../../../docs/ux-research/tenant-control-glossary.md'),
  'utf8',
);
const never = glossary
  .split('\n')
  .filter((l) => l.startsWith('|') && !l.includes('---') && !l.includes('Never say'))
  .flatMap((l) => (l.split('|')[3] ?? '').split(','))
  .concat([
    'impersonate',
    'act as',
    'break-glass',
    'consent',
    'session',
    'revoke',
    'kill',
    'mode',
    'policy',
    'justification',
    'user_id',
  ])
  .map((w) => w.trim().toLowerCase())
  .filter((w) => /^[a-z_ -]{3,}$/.test(w));

describe('Users page words', () => {
  it('has a never-say list and the same keys in bn and en', () => {
    expect(never).toContain('log out');
    expect(Object.keys(bn)).toEqual(Object.keys(en));
  });

  it.each([
    ['en', en],
    ['bn', bn],
  ])('%s has no never-say word', (_lang, json) => {
    const hits = strings(json).filter((s) =>
      never.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(s)),
    );
    expect(hits).toEqual([]);
  });
});
