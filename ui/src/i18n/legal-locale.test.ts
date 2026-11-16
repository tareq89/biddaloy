import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const FILES = ['legal', 'register', 'students', 'admission-public', 'helpHint'];
// Epic 59 glossary "never say" terms. Enum keys stay in code, never on screen.
const BANNED = [/\bToS\b/, /\bDPA\b/, /\bSLA\b/, /consent status/i];

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

describe('legal i18n glossary', () => {
  for (const locale of ['bn', 'en']) {
    for (const f of FILES) {
      it(`${locale}/${f}.json has no banned term`, () => {
        const json = JSON.parse(
          readFileSync(join(__dirname, 'locales', locale, `${f}.json`), 'utf8'),
        );
        for (const s of strings(json)) for (const re of BANNED) expect(s).not.toMatch(re);
      });
    }
  }
});
