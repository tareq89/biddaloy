import { toLatinDigits } from './digits';
import type { RegionConfig } from './region-config';

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

/** Formats a national number (already validated — see `parsePhone`) as
 * `+880 1XXX-XXXXXX`. Only defined for Bangladesh's 10-digit mobile shape
 * today; a second region's `displayFormat` becomes configurable once
 * [8.7.2] lands the real `RegionConfig`. */
export function formatPhone(nationalNumber: string, config: RegionConfig): string {
  const result = parsePhone(nationalNumber, config);
  if (!result.valid) {
    throw new RangeError(
      `formatPhone: "${nationalNumber}" is not a valid ${config.phone.country} number`,
    );
  }

  const digits = result.value;
  return `+${config.phone.country} ${digits.slice(0, 4)}-${digits.slice(4)}`;
}
