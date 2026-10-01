import { describe, expect, it } from 'vitest';

import { EnrollmentStatus } from './index';
import {
  LIFECYCLE_EVENT_TARGET_STATUS,
  PublicExamType,
  StudentLifecycleEventType,
} from './student-lifecycle';

describe('student-lifecycle enums [39.1.1]', () => {
  it('maps every event type to a valid EnrollmentStatus', () => {
    for (const t of Object.values(StudentLifecycleEventType)) {
      expect(Object.values(EnrollmentStatus)).toContain(LIFECYCLE_EVENT_TARGET_STATUS[t]);
    }
  });

  it('has unique PublicExamType values', () => {
    const v = Object.values(PublicExamType);
    expect(new Set(v).size).toBe(v.length);
  });
});
