const LATIN_DIGITS = '0123456789';
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/**
 * Normalizes a string that may contain **either** Bengali or Latin digits
 * (never assume which — a user's keyboard layout, not the app's locale,
 * decides what they type) down to plain ASCII digits, leaving every other
 * character untouched.
 *
 * Mirrors `ui/src/utils/digits.ts`'s `toLatinDigits` semantics exactly, but
 * the server does not depend on the `ui/` package so the logic is
 * duplicated here rather than imported.
 */
export function toLatinDigits(input: string): string {
  return input.replace(/[০-৯]/g, (digit) => LATIN_DIGITS[BN_DIGITS.indexOf(digit)] ?? digit);
}
