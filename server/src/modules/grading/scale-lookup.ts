/**
 * [20.2.1] Pure, dependency-free lookups Epic 19.0's result computation
 * (`#901`) calls directly — no repository, no tenant, unit-testable
 * without a database.
 */

import { BandRange } from './band-validation';

/**
 * [D2] Half-up rounding to the nearest integer percentage — the only
 * place in the codebase that rounds a percentage for grading purposes.
 * `Math.round` already rounds .5 up for positive numbers, but is spelled
 * out via `Math.floor(x + 0.5)` here so the rounding rule is explicit and
 * doesn't silently change if this ever needs to handle negative input.
 */
export function roundHalfUp(percent: number): number {
  return Math.floor(percent + 0.5);
}

/**
 * The band whose [percent_from, percent_to] contains `percent`, rounded
 * half-up to an integer first (bands are int columns). `null` when no
 * band covers it — callers decide how to treat an unmatched percentage,
 * this function never throws and never re-validates the band set (that's
 * `validateBands`'s job).
 */
export function gradeFor<T extends BandRange>(bands: T[], percent: number): T | null {
  const rounded = roundHalfUp(percent);
  return bands.find((band) => rounded >= band.percent_from && rounded <= band.percent_to) ?? null;
}

export interface ScaleRef {
  academic_year_id: string;
  class_id: string | null;
}

/**
 * [D1] The scale to grade against for one (academic year, class): a
 * class-specific override wins when one exists, otherwise the year's
 * default (`class_id: null`) scale, otherwise `null` — never guesses.
 */
export function resolveScale<T extends ScaleRef>(
  scales: T[],
  academicYearId: string,
  classId: string | null,
): T | null {
  if (classId) {
    const override = scales.find(
      (scale) => scale.academic_year_id === academicYearId && scale.class_id === classId,
    );
    if (override) return override;
  }
  return (
    scales.find((scale) => scale.academic_year_id === academicYearId && scale.class_id === null) ??
    null
  );
}
