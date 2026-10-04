import type { RegionConfig } from '../i18n/region-config';

import { toLatinDigits } from './digits';

export type PhoneParseResult = { valid: true; value: string } | { valid: false; reason: string };

/**
 * Strips everything but digits (accepting either numeral system), then the
 * country code and/or a leading trunk `0` if present, and validates what's
 * left against `config.phone.pattern`. Returns a discriminated union
 * rather than throwing or returning `null`/`""` on invalid input — a
 * silently-mangled phone number (SMS reminders that never arrive) is worse
 * than one a caller has to explicitly branch on.
 */
export function parsePhone(input: string, config: RegionConfig): PhoneParseResult {
  let digits = toLatinDigits(input).replace(/[^\d]/g, '');

  if (digits.startsWith(config.phone.country)) {
    digits = digits.slice(config.phone.country.length);
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  if (!config.phone.pattern.test(digits)) {
    return {
      valid: false,
      reason: `expected a number matching ${config.phone.country}'s pattern (e.g. ${config.phone.example})`,
    };
  }

  return { valid: true, value: digits };
}

/** D8 display form (`01711-000004`, Latin digits always: D6). Never throws (C20): empty is `—`,
 * a number the region cannot parse is shown as typed. Uses
 * `config.phone.displayFormat`'s mask (`X` = next digit, everything else
 * a literal) — `'0XXXX-XXXXXX'` turns `1712345678` into `01712-345678`.
 * A region with a different grouping is a mask change, not a code
 * change here — proven by `region-config.spec.ts`'s second-region suite. */
export function formatPhone(value: string | null | undefined, config: RegionConfig): string {
  const raw = (value ?? '').trim();
  if (raw === '') return '—';
  const result = parsePhone(raw, config);
  if (!result.valid) return raw;
  const digits = result.value;
  let nextDigit = 0;
  return (
    config.phone.displayFormat.replace(/X/g, () => digits[nextDigit++] ?? '') +
    digits.slice(nextDigit)
  );
}
