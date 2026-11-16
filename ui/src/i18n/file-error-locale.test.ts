/** [60.3.4007] The two upload-scanner sentences (D13/D14): same keys in en and bn, none of the never-say words. */
import { describe, expect, it } from 'vitest';

import bn from './locales/bn/errors.json';
import en from './locales/en/errors.json';

const KEYS = ['fileHarmful', 'fileCheckUnavailable'] as const;
const NEVER = /malware|infected|virus|clamav|scanner|503|ম্যালওয়্যার|ভাইরাস|স্ক্যানার/i;

describe('file error sentences', () => {
  it.each(KEYS)('%s exists in en and bn and says nothing technical', (key) => {
    for (const tree of [en, bn] as Array<Record<string, string>>) {
      expect(tree[key]).toBeTruthy();
      expect(tree[key]).not.toMatch(NEVER);
    }
  });
});
