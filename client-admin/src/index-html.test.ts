// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DEFAULT_LOCALE } from '@biddaloy/ui/i18n';
import { describe, expect, it } from 'vitest';

/**
 * [8.14.13] Drift guard: `index.html`'s pre-hydration `<html lang>` script
 * is hand-written (no bundler has run yet at that point, so it cannot
 * import `ui/src/i18n/locale-storage.ts`). This test reads the raw file
 * and asserts its literal default and storage key stay in sync with the
 * real module, next to the code being changed, instead of silently
 * drifting the first time someone renames either one.
 */

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf-8');

describe('index.html pre-hydration lang', () => {
  it('sets the static <html lang> to the default locale', () => {
    expect(html).toContain(`lang="${DEFAULT_LOCALE}"`);
  });

  it('reads the same localStorage key the locale module persists to', () => {
    expect(html).toContain("localStorage.getItem('biddaloy:locale')");
  });

  it('falls back to the same literal default the locale module exports', () => {
    expect(html).toContain(`locale = '${DEFAULT_LOCALE}'`);
  });
});
