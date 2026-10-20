import { describe, it, expect } from 'vitest';
import { joinedAfterExam } from './exam-cohort';

describe('joinedAfterExam', () => {
  it('is false when the exam has no known last sitting', () => {
    expect(joinedAfterExam(new Date('2030-01-01T00:00:00Z'), null)).toBe(false);
  });
  it('is false when enrolled the day before the last sitting', () => {
    expect(joinedAfterExam(new Date('2025-02-28T10:00:00Z'), '2025-03-01')).toBe(false);
  });
  it('is false when enrolled late on the last sitting day (Dhaka)', () => {
    expect(joinedAfterExam(new Date('2025-03-01T17:59:00Z'), '2025-03-01')).toBe(false);
  });
  it('is true at 00:30 Dhaka the next day', () => {
    expect(joinedAfterExam(new Date('2025-03-01T18:30:00Z'), '2025-03-01')).toBe(true);
  });
  it('is true when enrolled the next day', () => {
    expect(joinedAfterExam(new Date('2025-03-02T00:00:00Z'), '2025-03-01')).toBe(true);
  });
});
