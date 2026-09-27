import { describe, expect, it } from 'vitest';

import { ProgramEnrollmentStatus } from './programs';

describe('ProgramEnrollmentStatus', () => {
  it('has exactly the three D19/D20 statuses', () => {
    expect(ProgramEnrollmentStatus).toEqual({
      ACTIVE: 'ACTIVE',
      COMPLETED: 'COMPLETED',
      WITHDRAWN: 'WITHDRAWN',
    });
  });

  it('has no extra keys', () => {
    expect(Object.keys(ProgramEnrollmentStatus).sort()).toEqual([
      'ACTIVE',
      'COMPLETED',
      'WITHDRAWN',
    ]);
  });
});
