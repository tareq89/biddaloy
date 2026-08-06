import { renderDigits, toLatinDigits } from './digits';
import { groupDigits } from './grouping';
import type { RegionConfig } from './region-config';

/**
 * Generic (non-currency) number display — student counts, percentages,
 * roll numbers. Unlike `formatCurrency`, this isn't money, so a plain
 * `number` in and `toFixed` internally is fine; nothing here accumulates
 * arithmetic error the way chained currency math would.
 */
export function formatNumber(
  value: number,
  config: RegionConfig,
  options: { decimals?: number } = {},
): string {
  const { decimals = 0 } = options;
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [integerPart = '0', fractionPart = ''] = fixed.split('.');
  const grouped = groupDigits(integerPart, 'thousand');
  const plain = fractionPart ? `${grouped}.${fractionPart}` : grouped;
  const numeral = renderDigits(plain, config.numerals);
  return negative ? `-${numeral}` : numeral;
}

/** Accepts either digit system and grouping separators; returns a plain
 * JS number. Throws `RangeError` on invalid input, same reasoning as
 * `parseCurrency`. Unlike `parseCurrency`/`parsePhone`, no `RegionConfig`
 * is needed — digit-system detection is automatic (`toLatinDigits` accepts
 * both), and grouping separators are stripped unconditionally regardless
 * of style. */
export function parseNumber(input: string): number {
  const cleaned = toLatinDigits(input).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new RangeError(`parseNumber: "${input}" is not a valid number`);
  }
  return Number(cleaned);
}
