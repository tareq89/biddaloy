import type { RegionConfig } from '../i18n/region-config';

import { renderDigits, toLatinDigits } from './digits';
import { groupDigits } from './grouping';

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
  if (!Number.isSafeInteger(amountMinorUnits)) {
    throw new RangeError(
      `formatCurrency expects an integer amount in minor units, got ${amountMinorUnits}. ` +
        "Convert to paisa/cents first — see this file's header comment. Amounts beyond " +
        `Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER}) can't be represented exactly as a ` +
        'JS number at all — that also rules out `Number.isInteger`, which returns `true` for ' +
        'plenty of values past that boundary that no longer mean what they look like.',
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
  // Built as a `bigint` first, not `Number(...)` directly — that string can
  // have arbitrarily many digits (nothing above bounds `integerPart`'s
  // length), and going straight to `Number` would silently round anything
  // past `Number.MAX_SAFE_INTEGER`, exactly the float-precision loss this
  // module's header comment says it avoids. `bigint` parses the digits
  // exactly; only the final range check below can lose information, and it
  // throws instead of losing it.
  const minorUnitsBig = BigInt(`${integerPart}${paddedFraction}`);
  if (minorUnitsBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(
      `parseCurrency: "${input}" is larger than Number.MAX_SAFE_INTEGER minor units and can't be ` +
        'represented exactly as a JS number.',
    );
  }

  const minorUnits = Number(minorUnitsBig);
  return signPart === '-' ? -minorUnits : minorUnits;
}

/**
 * Rounds `value` to `decimals` fractional digits half-up, working on its
 * shortest round-trip decimal string (`value.toString()`) rather than
 * `toFixed`, which rounds the underlying binary double directly.
 * `(1.005).toFixed(2)` is `"1.00"` — the closest double to `1.005` is
 * actually `1.00499999999999989...`, so binary rounding truncates it down
 * — but `(1.005).toString()` is the exact literal `"1.005"`, since that's
 * the shortest decimal string that round-trips back to the same double.
 * Rounding that string by digit instead recovers the half-up result a
 * human typing `1.005` expects: `1.01`.
 */
function roundDecimalString(value: number, decimals: number): string {
  const str = value.toString();
  if (/e/i.test(str)) {
    // Magnitude far enough from zero that `toString()` itself switches to
    // exponential notation — there's no extra binary-vs-decimal precision
    // to recover at that scale, so fall back to `toFixed`.
    return value.toFixed(decimals);
  }

  const negative = str.startsWith('-');
  const unsigned = negative ? str.slice(1) : str;
  const [integerPart, fractionPart = ''] = unsigned.split('.');
  if (fractionPart.length <= decimals) return value.toFixed(decimals);

  const keptFraction = fractionPart.slice(0, decimals);
  const roundUp = fractionPart.charCodeAt(decimals) >= '5'.charCodeAt(0);

  let combined = BigInt(integerPart + keptFraction || '0');
  if (roundUp) combined += 1n;

  const digits = combined.toString().padStart(decimals + 1, '0');
  const newInteger = digits.slice(0, digits.length - decimals) || '0';
  const newFraction = digits.slice(digits.length - decimals);
  const sign = negative && combined !== 0n ? '-' : '';
  return decimals > 0 ? `${sign}${newInteger}.${newFraction}` : `${sign}${newInteger}`;
}

/**
 * Formats a server-supplied amount that isn't already in minor units —
 * either a decimal-column string (`"500.00"`) or a JS number the server
 * summed in SQL (`SUM(...)`, which can carry float artifacts like
 * `2000.0000000000002` with more fractional digits than the currency's
 * configured precision, or a genuine half-cent value like `1.005`).
 * Rounding a number to `config.currency.decimals` before handing it to
 * `parseCurrency` absorbs both; a string is passed through unchanged,
 * since it came straight off a `decimal` column and is already exact.
 *
 * Second call site of this exact pattern (`fees-tab.tsx`'s summary cards,
 * originally [8.10.2]) is the line past which it earns a shared home next
 * to `formatCurrency`/`parseCurrency` instead of staying a local helper.
 */
export function formatServerAmount(amount: number | string, config: RegionConfig): string {
  const normalized =
    typeof amount === 'number' ? roundDecimalString(amount, config.currency.decimals) : amount;
  return formatCurrency(parseCurrency(normalized, config), config);
}
