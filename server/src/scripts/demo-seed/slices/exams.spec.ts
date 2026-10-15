import { describe, expect, it } from 'vitest';
import { academicYears } from '../dates';
import { examWindow } from './exams';

/**
 * The nightly reset seeds with anchor = today, all year round. The current year's exams are laid
 * out from the anchor, so near a year boundary they must stay inside the academic year (or be left
 * out), never spill into the year before or after.
 */
const EXAMS = [
  { name: 'Test Exam', term: 1, state: 'published' },
  { name: 'First Term Exam', term: 1, state: 'published' },
  { name: 'Half-Yearly Exam', term: 2, state: 'progress' },
  { name: 'Annual Exam', term: 3, state: 'next' },
] as const;

function windowsFor(kind: 'HIGH' | 'COLLEGE', anchor: string) {
  const span = academicYears(kind, 1, anchor)[0];
  const year = { ...span, isCurrent: true };
  return {
    year,
    windows: EXAMS.map((e) => ({ ...e, w: examWindow(year, e, anchor) })),
  };
}

describe('examWindow (current year)', () => {
  // Early January, mid-July (College's first weeks) and late December.
  const cases: ['HIGH' | 'COLLEGE', string][] = [
    ['HIGH', '2026-01-10'],
    ['COLLEGE', '2026-07-15'],
    ['HIGH', '2026-07-15'],
    ['HIGH', '2026-12-20'],
    ['COLLEGE', '2026-06-25'],
  ];

  for (const [kind, anchor] of cases) {
    it(`${kind} anchor ${anchor}: every window is inside the academic year`, () => {
      const { year, windows } = windowsFor(kind, anchor);
      for (const { name, state, w } of windows) {
        if (!w) continue; // left out: no room this year
        expect(w.start >= year.start, `${name} starts before the year`).toBe(true);
        expect(w.end <= year.end, `${name} ends after the year`).toBe(true);
        expect(w.start <= w.end, `${name} window is empty`).toBe(true);
        // A published or in-progress exam was sat before the anchor; the next one is after it.
        if (state === 'next')
          expect(w.start > anchor, `${name} should be after the anchor`).toBe(true);
        else expect(w.end < anchor, `${name} should be before the anchor`).toBe(true);
      }
    });
  }

  it('early January leaves out the exams that would fall in the previous year', () => {
    const { windows } = windowsFor('HIGH', '2026-01-10');
    const byName = Object.fromEntries(windows.map((x) => [x.name, x.w]));
    expect(byName['Test Exam']).toBeNull();
    expect(byName['First Term Exam']).toBeNull();
    expect(byName['Half-Yearly Exam']).toEqual({ start: '2026-01-01', end: '2026-01-07' });
  });

  it('late December fits the Annual exam into the last days of the year', () => {
    const { windows } = windowsFor('HIGH', '2026-12-20');
    const annual = windows.find((x) => x.name === 'Annual Exam')!.w;
    expect(annual).toEqual({ start: '2026-12-21', end: '2026-12-31' });
  });

  it('mid-year keeps the usual layout (Annual 10 days out, two weeks long)', () => {
    const { windows } = windowsFor('HIGH', '2026-07-15');
    const annual = windows.find((x) => x.name === 'Annual Exam')!.w;
    expect(annual).toEqual({ start: '2026-07-25', end: '2026-08-07' });
    expect(windows.every((x) => x.w !== null)).toBe(true);
  });
});
