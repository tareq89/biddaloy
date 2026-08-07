import { bnDigits, type NumeralSystem } from '../i18n/region-config';

const LATIN_DIGITS = '0123456789';

/** Renders a string of ASCII digits (and any non-digit characters, passed
 * through unchanged — grouping separators, decimal points, signs) in the
 * given numeral system. */
export function renderDigits(input: string, numerals: NumeralSystem): string {
  if (numerals === 'latin') return input;
  return input.replace(/[0-9]/g, (digit) => bnDigits[LATIN_DIGITS.indexOf(digit)] ?? digit);
}

/** Normalizes a string that may contain **either** Bengali or Latin digits
 * (never assume which — a user's keyboard layout, not the app's locale,
 * decides what they type) down to plain ASCII digits, leaving every other
 * character untouched. This is the one place both digit systems are
 * accepted as input; every parser in this module routes through it first. */
export function toLatinDigits(input: string): string {
  return input.replace(/[০-৯]/g, (digit) => LATIN_DIGITS[bnDigits.indexOf(digit)] ?? digit);
}
