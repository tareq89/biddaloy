/**
 * [20.2.1] Pure validation for one scale's proposed band set. No
 * repository, no tenant — `grading.service.ts` and `recompute.service.ts`
 * both run this against a plain array before touching the database, and
 * `#901` (Epic 19.0) can unit-test its own scale lookups against the same
 * shape without a database.
 *
 * A band set is valid when it covers 0–100 exactly, once: sorted by
 * `percent_from`, the first band starts at 0, the last ends at 100, and
 * each band's `percent_from` is exactly one more than the previous band's
 * `percent_to` — no gap, no overlap. Every problem is collected and
 * returned together (not "fail fast") — an admin fixing a scale wants the
 * whole list of what's wrong, not one error at a time.
 */

export interface BandRange {
  percent_from: number;
  percent_to: number;
}

export type BandValidationProblemType =
  'out_of_range' | 'inverted' | 'missing_zero' | 'missing_hundred' | 'gap' | 'overlap' | 'empty';

export interface BandValidationProblem {
  type: BandValidationProblemType;
  message: string;
  /** Index into the *input* array (pre-sort), when the problem is about
   * one specific band rather than the set as a whole. */
  index?: number;
}

export function validateBands(bands: BandRange[]): BandValidationProblem[] {
  const problems: BandValidationProblem[] = [];

  if (bands.length === 0) {
    return [{ type: 'empty', message: 'At least one band is required' }];
  }

  bands.forEach((band, index) => {
    if (band.percent_from < 0 || band.percent_to > 100) {
      problems.push({
        type: 'out_of_range',
        message: `Band ${index} (${band.percent_from}-${band.percent_to}) must be within 0-100`,
        index,
      });
    }
    if (band.percent_from > band.percent_to) {
      problems.push({
        type: 'inverted',
        message: `Band ${index} has percent_from (${band.percent_from}) after percent_to (${band.percent_to})`,
        index,
      });
    }
  });

  // Sorted copy for the coverage checks below — the input order is
  // whatever the caller sent, not necessarily ascending.
  const sorted = [...bands].sort((a, b) => a.percent_from - b.percent_from);

  if (sorted[0].percent_from !== 0) {
    problems.push({ type: 'missing_zero', message: 'Bands must start at 0' });
  }
  if (sorted[sorted.length - 1].percent_to !== 100) {
    problems.push({ type: 'missing_hundred', message: 'Bands must end at 100' });
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.percent_from > prev.percent_to + 1) {
      problems.push({
        type: 'gap',
        message: `Gap between ${prev.percent_to} and ${curr.percent_from}`,
      });
    } else if (curr.percent_from <= prev.percent_to) {
      problems.push({
        type: 'overlap',
        message: `Bands ${prev.percent_from}-${prev.percent_to} and ${curr.percent_from}-${curr.percent_to} overlap`,
      });
    }
  }

  return problems;
}
