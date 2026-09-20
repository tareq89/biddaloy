import { describe, expect, it } from 'vitest';

import { EntityLabel } from './entity-label';

describe('EntityLabel', () => {
  const keys = Object.keys(EntityLabel);
  const values = Object.values(EntityLabel);

  it('is non-empty', () => {
    expect(keys.length).toBeGreaterThan(0);
  });

  it('has unique values', () => {
    expect(new Set(values).size).toBe(values.length);
  });

  it('includes the Epic 35.0 tenant-override names', () => {
    const expectedKeys = [
      'class',
      'section',
      'student',
      'guardian',
      'staff',
      'teacher',
      'academicYear',
      'subject',
      'fee',
      'invoice',
      'payment',
    ] as const;

    for (const key of expectedKeys) {
      expect(keys).toContain(key);
      // Each value is a valid key of the union type.
      const value: EntityLabel = EntityLabel[key];
      expect(value).toBe(key);
    }
  });
});
