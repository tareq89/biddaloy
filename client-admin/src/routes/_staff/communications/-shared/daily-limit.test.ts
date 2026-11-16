import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const load = (locale: string) => {
  const file = resolve(
    __dirname,
    `../../../../../../ui/src/i18n/locales/${locale}/communications.json`,
  );
  const json = JSON.parse(readFileSync(file, 'utf8'));
  return { ...json.dailyLimit, log: json.deliveryErrors.dailyLimit } as Record<string, string>;
};

describe('daily limit words [#3994]', () => {
  const en = load('en');
  const bn = load('bn');

  it('has every key in en and bn, with the numbers interpolated', () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const locale of [en, bn]) {
      expect(locale['batchTooBig']).toContain('{{remaining}}');
      expect(locale['batchTooBig']).toContain('{{requested}}');
      expect(locale['none']).toContain('{{limit}}');
      expect(locale['leftToday']).toContain('{{remaining}}');
      expect(locale['leftToday']).toContain('{{limit}}');
    }
  });

  it('never says cap, quota, rate limit or throttle', () => {
    for (const value of [...Object.values(en), ...Object.values(bn)]) {
      expect(value).not.toMatch(/\b(cap|quota|rate limit|throttle)/i);
    }
  });
});
