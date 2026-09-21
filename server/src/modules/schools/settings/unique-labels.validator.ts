import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const MAX_ENTRIES = 20;
const MAX_LENGTH = 50;

/**
 * Pure check: what, if anything, is wrong with this label list. Returns
 * `null` when valid, otherwise the reason. Kept as the single source of
 * truth so `validate()` and `defaultMessage()` can't drift into reporting a
 * different rule than the one that actually failed.
 */
function findInvalidReason(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return 'must be an array';
  }
  if (value.length > MAX_ENTRIES) {
    return `must have at most ${MAX_ENTRIES} entries`;
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() !== entry || entry.length === 0) {
      return 'each entry must be a non-empty, trimmed string';
    }
    if (entry.length > MAX_LENGTH) {
      return `each entry must be at most ${MAX_LENGTH} characters`;
    }
    const key = entry.toLowerCase();
    if (seen.has(key)) {
      return `duplicate entry "${entry}" (case-insensitive)`;
    }
    seen.add(key);
  }
  return null;
}

/**
 * `organisation.shifts` / `.versions` / `.groups` (33.1.1) — a tenant's own
 * vocabulary for these org-structure concepts (33.0's decision that shift/
 * version/group are settings values, not entities). Each entry must be a
 * trimmed, non-empty string of at most 50 characters, the list at most 20
 * entries, and no two entries the same word once case is ignored — "Morning"
 * and "morning" are the same shift to whoever reads this list back, so
 * letting both in would silently double-count it downstream.
 *
 * Stateless by design: class-validator resolves one instance of this
 * constraint and reuses it across every request, so `validate()` and
 * `defaultMessage()` must each derive their answer from the arguments
 * they're given rather than from instance state — anything stored on
 * `this` in `validate()` could otherwise be read back by a concurrent
 * request's `defaultMessage()` for a *different* tenant's value.
 */
@ValidatorConstraint({ name: 'isUniqueLabelList', async: false })
export class UniqueLabelListConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return findInvalidReason(value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return `"${args.property}" ${findInvalidReason(args.value)}`;
  }
}
