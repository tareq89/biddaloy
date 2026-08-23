import { describe, expect, it } from 'vitest';

import { parseValidationFieldErrors } from './server-validation-errors';

describe('parseValidationFieldErrors', () => {
  const knownFields = ['full_name', 'email', 'class_section_id'] as const;

  it('maps each message onto the field it leads with', () => {
    const result = parseValidationFieldErrors(
      ['full_name should not be empty', 'email must be an email'],
      knownFields,
    );
    expect(result).toEqual({
      full_name: 'full_name should not be empty',
      email: 'email must be an email',
    });
  });

  it('ignores a message whose leading token is not a known field', () => {
    const result = parseValidationFieldErrors(['unexpected internal error'], knownFields);
    expect(result).toEqual({});
  });

  it('does not treat one field name as a prefix match for another', () => {
    // "class_section" is not "class_section_id" — a naive prefix check
    // without the trailing-space boundary would still match here.
    const result = parseValidationFieldErrors(['class_section must be a UUID'], knownFields);
    expect(result).toEqual({});
  });

  it('keeps the last message when two errors target the same field', () => {
    const result = parseValidationFieldErrors(
      ['email should not be empty', 'email must be an email'],
      knownFields,
    );
    expect(result).toEqual({ email: 'email must be an email' });
  });
});
