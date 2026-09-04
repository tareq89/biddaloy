import { toLatinDigits } from './bengali-digits.util';
import { escapeLikePattern } from './escape-like.util';

/**
 * Normalizes a raw search-term query param before it is embedded in an
 * `ILIKE :search` pattern:
 *
 * 1. Converts Bengali digits to Latin so a Bengali-keyboard roll number
 *    (`১০৩`) matches a Latin-stored one (`103`).
 * 2. Trims surrounding whitespace.
 * 3. Escapes LIKE metacharacters (`%`, `_`, `\`) so user input can never act
 *    as a wildcard.
 *
 * Returns `null` for an empty/whitespace-only term so callers can skip
 * adding the `ILIKE` clause entirely instead of matching `%%`.
 *
 * Every service that adds a free-text `search` filter should route through
 * this function rather than re-implementing the normalize/escape pair.
 */
export function normalizeSearchTerm(input: string | undefined | null): string | null {
  if (!input) return null;
  const trimmed = toLatinDigits(input).trim();
  if (trimmed.length === 0) return null;
  return escapeLikePattern(trimmed);
}
