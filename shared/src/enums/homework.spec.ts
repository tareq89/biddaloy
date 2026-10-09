import { describe, expect, it } from 'vitest';

import {
  HomeworkAssignmentStatus,
  HomeworkGradingMode,
  HomeworkSubmissionStatus,
  SyllabusTopicStatus,
} from './homework';

describe('homework/syllabus enums', () => {
  const cases: Array<[string, Record<string, string>]> = [
    ['HomeworkGradingMode', HomeworkGradingMode],
    ['HomeworkAssignmentStatus', HomeworkAssignmentStatus],
    ['HomeworkSubmissionStatus', HomeworkSubmissionStatus],
    ['SyllabusTopicStatus', SyllabusTopicStatus],
  ];

  it.each(cases)('%s is non-empty with unique values', (_name, obj) => {
    const values = Object.values(obj);
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values).size).toBe(values.length);
  });

  it('HomeworkGradingMode has the three modes', () => {
    expect(Object.values(HomeworkGradingMode).sort()).toEqual(['MARKS', 'PARTIAL', 'TICK']);
  });

  it('HomeworkAssignmentStatus has the three states', () => {
    expect(Object.values(HomeworkAssignmentStatus).sort()).toEqual([
      'ACTIVE',
      'DEACTIVATED',
      'SUPERSEDED',
    ]);
  });

  it('HomeworkSubmissionStatus has the four states', () => {
    expect(Object.values(HomeworkSubmissionStatus).sort()).toEqual([
      'DONE',
      'NOT_SUBMITTED',
      'PARTIAL',
      'SUBMITTED',
    ]);
  });

  it('SyllabusTopicStatus has the three states', () => {
    expect(Object.values(SyllabusTopicStatus).sort()).toEqual(['DONE', 'IN_PROGRESS', 'PLANNED']);
  });
});
