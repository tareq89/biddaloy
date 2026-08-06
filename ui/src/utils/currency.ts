import { renderDigits, toLatinDigits } from './digits';
import { groupDigits } from './grouping';
import type { RegionConfig } from './region-config';

/**
 * `amountMinorUnits` is always an **integer count of minor units** — paisa
 * for BDT (`decimals: 2`) — never a float major-unit amount. This is a
 * deliberate deviation from the issue's literal example
 * (`formatCurrency(123456)` → `৳১,২৩,৪৫৬`, which reads as 123456 *taka*
 * with no decimals shown): accepting a plain major-unit `number` at this
 * boundary would readmit exactly the floating-point risk the issue's own
 * "never uses floating point for money" acceptance criterion rules out —
 * `0.1 + 0.2` is not `0.3` in IEEE 754, and a caller building up an amount
 * with ordinary arithmetic before formatting it would carry that error in.
 * Minor units are always integers, so every operation here — grouping,
 * signing, padding — is exact integer/string manipulation. `formatCurrency
 * (12345600, REGION_BD_BN)` produces the same digit grouping as the issue's
 * example, `৳১,২৩,৪৫৬.০০` (see `currency.spec.ts`), just with the paisa
 * shown, because BDT genuinely has them.
 */
export function formatCurrency(amountMinorUnits: number, config: RegionConfig): string {
  if (!Number.isInteger(amountMinorUnits)) {
    throw new RangeError(
      `formatCurrency expects an integer amount in minor units, got ${amountMinorUnits}. ` +
        "Convert to paisa/cents first — see this file's header comment.",
    );
  }

  const { decimals, grouping, symbol, position } = config.currency;
  const negative = amountMinorUnits < 0;
  const digits = Math.abs(amountMinorUnits)
    .toString()
    .padStart(decimals + 1, '0');
  const integerPart = decimals > 0 ? digits.slice(0, -decimals) : digits;
  const fractionPart = decimals > 0 ? digits.slice(-decimals) : '';

  const groupedInteger = groupDigits(integerPart, grouping);
  const plain = fractionPart ? `${groupedInteger}.${fractionPart}` : groupedInteger;
  const numeral = renderDigits(plain, config.numerals);
  const sign = negative ? '-' : '';

  return position === 'prefix' ? `${sign}${symbol}${numeral}` : `${sign}${numeral}${symbol}`;
}

/**
 * The inverse of `formatCurrency` — accepts either digit system, the
 * configured symbol (optional — a plain typed-in amount has none), and
 * grouping separators, and returns an integer count of minor units.
 * Throws `RangeError` on anything that isn't a valid amount for `config`
 * rather than silently truncating or returning `NaN` — a mis-parsed
 * payment amount is a correctness bug, not something to guess past.
 */
export function parseCurrency(input: string, config: RegionConfig): number {
  const { decimals, symbol } = config.currency;
  let cleaned = toLatinDigits(input).trim();
  cleaned = cleaned.split(symbol).join('').replace(/,/g, '').trim();

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) {
    throw new RangeError(`parseCurrency: "${input}" is not a valid ${config.currency.code} amount`);
  }

  const [, signPart, integerPart, fractionPart = ''] = match;
  if (fractionPart.length > decimals) {
    throw new RangeError(
      `parseCurrency: "${input}" has more than ${decimals} decimal place(s) for ${config.currency.code}`,
    );
  }

  const paddedFraction = fractionPart.padEnd(decimals, '0');
  const minorUnits = Number(`${integerPart}${paddedFraction}`);
  return signPart === '-' ? -minorUnits : minorUnits;
}
