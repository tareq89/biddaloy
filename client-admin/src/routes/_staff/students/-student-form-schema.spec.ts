import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildCreatePayload,
  buildStudentFormSchema,
  defaultStudentFormValues,
} from './-student-form-schema';

const messages = {
  fullNameRequired: 'Full name is required.',
  classSectionRequired: 'Select a class and section.',
  rollNumberInvalid: 'Roll number must be a positive whole number.',
};

describe('buildStudentFormSchema: roll_number', () => {
  const schema = buildStudentFormSchema(messages);
  const validBaseValues = {
    ...defaultStudentFormValues(),
    full_name: 'Rahim Uddin',
    class_section_id: 'section-1',
  };

  it('rejects "0" — not a positive whole number', () => {
    const result = schema.safeParse({ ...validBaseValues, roll_number: '0' });
    expect(result.success).toBe(false);
  });

  it('accepts a positive whole number', () => {
    const result = schema.safeParse({ ...validBaseValues, roll_number: '7' });
    expect(result.success).toBe(true);
  });

  it('accepts an empty string (optional)', () => {
    const result = schema.safeParse({ ...validBaseValues, roll_number: '' });
    expect(result.success).toBe(true);
  });
});

describe('buildCreatePayload: date_of_birth serialization', () => {
  // Bangladesh is UTC+6 — the app's only region — so `toISOString()`
  // (which converts to UTC first) is exactly the case this regression
  // test needs to force, regardless of the machine running it.
  const originalTz = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'Asia/Dhaka';
  });

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('serializes the local calendar date, not the UTC-shifted one', () => {
    const values = {
      ...defaultStudentFormValues(),
      full_name: 'Rahim Uddin',
      class_section_id: 'section-1',
      date_of_birth: new Date(2024, 0, 15), // local midnight, 15 Jan 2024
    };

    const payload = buildCreatePayload(values);

    expect(payload.date_of_birth).toBe('2024-01-15');
  });
});
