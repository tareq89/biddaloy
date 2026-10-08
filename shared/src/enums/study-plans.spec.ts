import { describe, expect, it } from 'vitest';

import {
  LessonDeliveryReason,
  LessonDeliveryStatus,
  NOT_A_PERIOD_REASONS,
  STUDY_PLAN_CSV_COLUMNS,
  STUDY_PLAN_LIMITS,
} from './study-plans';

describe('study-plan enums', () => {
  it('LessonDeliveryStatus values', () => {
    expect(Object.values(LessonDeliveryStatus).sort()).toEqual(['NOT_TAUGHT', 'PARTLY', 'TAUGHT']);
  });

  it('LessonDeliveryReason values', () => {
    expect(Object.values(LessonDeliveryReason).sort()).toEqual([
      'CANCELLED',
      'EXAM',
      'ON_LEAVE',
      'OTHER',
      'SCHOOL_CLOSED',
      'TEACHER_ABSENT',
    ]);
  });

  it('NOT_A_PERIOD_REASONS is exactly SCHOOL_CLOSED, EXAM, CANCELLED (D39)', () => {
    expect([...NOT_A_PERIOD_REASONS].sort()).toEqual(['CANCELLED', 'EXAM', 'SCHOOL_CLOSED']);
    for (const owed of ['TEACHER_ABSENT', 'ON_LEAVE', 'OTHER']) {
      expect(NOT_A_PERIOD_REASONS as readonly string[]).not.toContain(owed);
    }
  });

  it('CSV columns are fixed', () => {
    expect([...STUDY_PLAN_CSV_COLUMNS]).toEqual(['title', 'periods', 'topic', 'notes']);
  });

  it('teacher edit window is 7 days (D29)', () => {
    expect(STUDY_PLAN_LIMITS.teacherEditDays).toBe(7);
  });
});
