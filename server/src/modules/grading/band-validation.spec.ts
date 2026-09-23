import { describe, it, expect } from 'vitest';
import { validateBands } from './band-validation';

describe('validateBands', () => {
  it('passes a full 0-100 cover with no gap/overlap', () => {
    const problems = validateBands([
      { percent_from: 80, percent_to: 100 },
      { percent_from: 60, percent_to: 79 },
      { percent_from: 0, percent_to: 59 },
    ]);
    expect(problems).toEqual([]);
  });

  it('reports a gap between bands', () => {
    const problems = validateBands([
      { percent_from: 0, percent_to: 49 },
      { percent_from: 60, percent_to: 100 },
    ]);
    expect(problems.some((p) => p.type === 'gap')).toBe(true);
  });

  it('reports an overlap between bands', () => {
    const problems = validateBands([
      { percent_from: 0, percent_to: 60 },
      { percent_from: 50, percent_to: 100 },
    ]);
    expect(problems.some((p) => p.type === 'overlap')).toBe(true);
  });

  it('reports an inverted range', () => {
    const problems = validateBands([
      { percent_from: 60, percent_to: 30 },
      { percent_from: 0, percent_to: 59 },
      { percent_from: 61, percent_to: 100 },
    ]);
    expect(problems.some((p) => p.type === 'inverted')).toBe(true);
  });

  it('reports missing 0 boundary', () => {
    const problems = validateBands([{ percent_from: 10, percent_to: 100 }]);
    expect(problems.some((p) => p.type === 'missing_zero')).toBe(true);
  });

  it('reports missing 100 boundary', () => {
    const problems = validateBands([{ percent_from: 0, percent_to: 90 }]);
    expect(problems.some((p) => p.type === 'missing_hundred')).toBe(true);
  });

  it('returns every problem together, not just the first', () => {
    // Missing 0, missing 100, and a gap between the two bands — all three
    // should show up in one call, not require three separate fixes/calls.
    const problems = validateBands([
      { percent_from: 10, percent_to: 40 },
      { percent_from: 50, percent_to: 90 },
    ]);
    const types = problems.map((p) => p.type).sort();
    expect(types).toEqual(['gap', 'missing_hundred', 'missing_zero'].sort());
  });

  it('reports an empty band set', () => {
    expect(validateBands([])).toEqual([{ type: 'empty', message: expect.any(String) }]);
  });
});
