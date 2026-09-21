import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const MAX_ENTRIES = 20;
const MAX_LENGTH = 50;

/**
 * `organisation.shifts` / `.versions` / `.groups` (33.1.1) — a tenant's own
 * vocabulary for these org-structure concepts (33.0's decision that shift/
 * version/group are settings values, not entities). Each entry must be a
 * trimmed, non-empty string of at most 50 characters, the list at most 20
 * entries, and no two entries the same word once case is ignored — "Morning"
 * and "morning" are the same shift to whoever reads this list back, so
 * letting both in would silently double-count it downstream.
 */
@ValidatorConstraint({ name: 'isUniqueLabelList', async: false })
export class UniqueLabelListConstraint implements ValidatorConstraintInterface {
  private lastError = '';

  validate(value: unknown): boolean {
    if (!Array.isArray(value)) {
      this.lastError = 'must be an array';
      return false;
    }
    if (value.length > MAX_ENTRIES) {
      this.lastError = `must have at most ${MAX_ENTRIES} entries`;
      return false;
    }
    const seen = new Set<string>();
    for (const entry of value) {
      if (typeof entry !== 'string' || entry.trim() !== entry || entry.length === 0) {
        this.lastError = 'each entry must be a non-empty, trimmed string';
        return false;
      }
      if (entry.length > MAX_LENGTH) {
        this.lastError = `each entry must be at most ${MAX_LENGTH} characters`;
        return false;
      }
      const key = entry.toLowerCase();
      if (seen.has(key)) {
        this.lastError = `duplicate entry "${entry}" (case-insensitive)`;
        return false;
      }
      seen.add(key);
    }
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    return `"${args.property}" ${this.lastError}`;
  }
}
