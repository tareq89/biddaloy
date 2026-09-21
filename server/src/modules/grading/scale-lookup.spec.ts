import { describe, it, expect } from 'vitest';
import { gradeFor, resolveScale, roundHalfUp } from './scale-lookup';

const BANDS = [
  { percent_from: 80, percent_to: 100, grade: 'A+' },
  { percent_from: 60, percent_to: 79, grade: 'A' },
  { percent_from: 0, percent_to: 59, grade: 'B' },
];

describe('roundHalfUp', () => {
  it('rounds .5 up', () => {
    expect(roundHalfUp(79.5)).toBe(80);
  });
});

describe('gradeFor', () => {
  it('79.4 stays in the 60-79 band, not 80-100', () => {
    expect(gradeFor(BANDS, 79.4)?.grade).toBe('A');
  });

  it('79.5 rounds up into the 80-100 band', () => {
    expect(gradeFor(BANDS, 79.5)?.grade).toBe('A+');
  });

  it('79.6 rounds up into the 80-100 band', () => {
    expect(gradeFor(BANDS, 79.6)?.grade).toBe('A+');
  });

  it('0 matches the lowest band', () => {
    expect(gradeFor(BANDS, 0)?.grade).toBe('B');
  });

  it('100 matches the highest band', () => {
    expect(gradeFor(BANDS, 100)?.grade).toBe('A+');
  });

  it('returns null when no band covers the percentage', () => {
    const gappy = [{ percent_from: 50, percent_to: 100, grade: 'A' }];
    expect(gradeFor(gappy, 20)).toBeNull();
  });
});

describe('resolveScale', () => {
  const YEAR = 'year-1';
  const CLASS = 'class-1';
  const scales = [
    { id: 'default', academic_year_id: YEAR, class_id: null },
    { id: 'override', academic_year_id: YEAR, class_id: CLASS },
  ];

  it('a class override wins over the year default', () => {
    expect(resolveScale(scales, YEAR, CLASS)?.id).toBe('override');
  });

  it('falls back to the year default when no override exists', () => {
    expect(resolveScale(scales, YEAR, 'class-2')?.id).toBe('default');
  });

  it('returns null when neither exists', () => {
    expect(resolveScale(scales, 'other-year', CLASS)).toBeNull();
  });
});
