import { boundedNumericString, toLatinDigits } from '@biddaloy/ui/utils';
import { z } from 'zod';

/**
 * `boundedNumericString` only accepts Latin digits, but a Bangla-numerals
 * school types "৩". Convert first, then validate; the shared helper stays as is.
 */
export function latinBounded(min: number, max: number) {
  return z.string().transform(toLatinDigits).pipe(boundedNumericString(min, max));
}
