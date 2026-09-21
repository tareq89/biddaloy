import { describe, it, expect } from 'vitest';
import { ValidationArguments } from 'class-validator';
import { UniqueLabelListConstraint } from './unique-labels.validator';

function args(value: unknown, property = 'shifts'): ValidationArguments {
  return {
    value,
    property,
    targetName: 'OrganisationSettingsDto',
    object: {},
    constraints: [],
  };
}

describe('UniqueLabelListConstraint', () => {
  it('accepts a valid list', () => {
    const constraint = new UniqueLabelListConstraint();
    expect(constraint.validate(['Morning', 'Day'])).toBe(true);
  });

  it('rejects a case-insensitive duplicate', () => {
    const constraint = new UniqueLabelListConstraint();
    expect(constraint.validate(['Morning', 'morning'])).toBe(false);
  });

  it('rejects more than 20 entries', () => {
    const constraint = new UniqueLabelListConstraint();
    const tooMany = Array.from({ length: 21 }, (_, i) => `Shift ${i}`);
    expect(constraint.validate(tooMany)).toBe(false);
  });

  // The instance class-validator resolves is shared across every request
  // (see the class doc comment) — a `defaultMessage()` call must never
  // describe a different value's failure than the one it was just given,
  // even when a `validate()` call for someone else's value ran in between.
  it('defaultMessage describes the value it is given, not a value validated earlier', () => {
    const constraint = new UniqueLabelListConstraint();

    // validate() runs for one (failing) value...
    const failedEarlier = constraint.validate(['Morning', 'morning']);
    expect(failedEarlier).toBe(false);

    // ...then defaultMessage() is asked about a DIFFERENT, differently
    // invalid value, without validate() running for it first.
    const message = constraint.defaultMessage(args(['x'.repeat(51)], 'versions'));

    expect(message).toContain('at most 50 characters');
    expect(message).not.toContain('duplicate');
    expect(message).not.toContain('morning');
  });
});
