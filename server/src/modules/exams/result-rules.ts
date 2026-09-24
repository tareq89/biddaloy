/**
 * [19.5.1] D5 — BD NCTB result rules, as pure functions over plain data:
 * no repository, no DI, nothing but arithmetic. `results.service.ts` is
 * the only caller that touches a database; every rule here is tested
 * from a hand-built table of marks (`result-rules.spec.ts`), because
 * these are exactly the rules the reference ERP's own analysis flagged
 * as undocumented (#781's "biggest unknown" §9) — designed here, not
 * copied.
 *
 * Rounding, stated once: half-up to 2 decimal places for a GPA, the same
 * spelled-out `Math.floor(x + 0.5)` shape as grading/scale-lookup.ts's
 * `roundHalfUp` (which rounds a *percentage* to an integer — a different
 * grain, reused as-is for that step). Nothing in this file rounds any
 * other way.
 */

import { MarkStatus } from '@biddaloy/shared';

export function roundHalfUp2(value: number): number {
  // Decimal exponent shifting (`Number(\`${m}e2\`)`), not `value * 100` —
  // plain float multiplication can land just under the boundary (e.g.
  // 8.005 * 100 === 800.4999999999999), rounding 8.005 down to 8.00
  // instead of up to 8.01. `toFixed` handles the shift correctly since it
  // operates on the decimal string representation.
  const shifted = Math.floor(Number(`${value}e2`) + 0.5);
  const result = Number(`${shifted}e-2`);
  return result === 0 ? 0 : result;
}

// --- Subject total from component marks (D10) ---

export interface ComponentInput {
  full_marks: number;
  /** null whenever `status` is not PRESENT — mirrors the `marks` table's
   * own D10 check constraint one grain up. */
  value: number | null;
  status: MarkStatus;
}

export interface SubjectTotal {
  obtained: number;
  full_marks: number;
  /** 0-100, unrounded — `gradeFor` (scale-lookup.ts) does its own
   * half-up rounding to an integer when it looks up a band. */
  percent: number;
  /** True when this subject counts as ABSENT — not "0%", a distinct
   * outcome that always fails the subject regardless of any band. */
  is_absent: boolean;
}

/**
 * One subject's total across its components (D10):
 * - Any component `ABSENT` fails the whole subject — "an absent student
 *   in a countable subject fails that subject", not a 0% mark that might
 *   still clear a very lenient pass band.
 * - Any component `EXEMPT` drops out of both the numerator and the
 *   denominator entirely, as if it were never part of the subject.
 * - A subject with no countable components left (all EXEMPT, or none at
 *   all) has no percent to compute — callers treat `full_marks === 0` as
 *   "does not contribute", the same way `is_graded_only`/a fourth
 *   subject already needs handling downstream.
 */
export function computeSubjectTotal(components: ComponentInput[]): SubjectTotal {
  if (components.some((c) => c.status === MarkStatus.ABSENT)) {
    return { obtained: 0, full_marks: 0, percent: 0, is_absent: true };
  }

  const counted = components.filter((c) => c.status !== MarkStatus.EXEMPT);
  if (counted.length === 0) {
    return { obtained: 0, full_marks: 0, percent: 0, is_absent: false };
  }

  const obtained = counted.reduce((sum, c) => sum + (c.value ?? 0), 0);
  const full_marks = counted.reduce((sum, c) => sum + c.full_marks, 0);
  const percent = full_marks > 0 ? (obtained / full_marks) * 100 : 0;

  return { obtained, full_marks, percent, is_absent: false };
}

// --- Band-derived grade/GPA/fail for one subject ---

export interface Band {
  percent_from: number;
  percent_to: number;
  grade: string;
  gpa: number | null;
  is_fail: boolean;
}

export interface SubjectGrade {
  grade: string;
  gpa: number | null;
  is_fail: boolean;
}

/**
 * Combines a subject's total (D10) with its scale band into the subject's
 * grade/GPA/fail outcome. An `ABSENT` subject fails regardless of any
 * band; a subject with no countable components (`full_marks === 0`,
 * i.e. every component was EXEMPT) is graded `null`/`'-'` and never
 * fails — there was nothing to fail.
 */
export function gradeSubjectTotal(
  total: SubjectTotal,
  gradeFor: (percent: number) => Band | null,
): SubjectGrade {
  if (total.is_absent) {
    return { grade: 'ABS', gpa: null, is_fail: true };
  }
  if (total.full_marks === 0) {
    return { grade: '-', gpa: null, is_fail: false };
  }
  const band = gradeFor(total.percent);
  if (!band) {
    // Unmatched band is a data problem (D5's band-coverage invariant
    // guarantees this never happens for a valid scale), not a silent
    // pass — fail closed rather than guess a grade.
    return { grade: 'ABS', gpa: null, is_fail: true };
  }
  return {
    grade: band.grade,
    gpa: band.gpa === null ? null : Number(band.gpa),
    is_fail: band.is_fail,
  };
}

// --- Fourth-subject rule (D14) ---

/** A fourth/optional subject contributes only the GPA it earns *above*
 * 2.0 to the overall average — the real BD NCTB rule this epic's D14
 * exists to support. A fourth subject at or below 2.0 contributes
 * nothing (never a penalty for taking one). */
export function fourthSubjectContribution(gpa: number | null): number {
  if (gpa === null) return 0;
  return Math.max(0, gpa - 2.0);
}

// --- Whole-result combination (fail rule, D5) ---

export interface SubjectResult extends SubjectGrade {
  subject_id: string;
  obtained: number;
  full_marks: number;
  /** A subject with `full_marks === 0` (every component exempted) or a
   * graded-only subject (Epic 20's D5 — grade shown, marks and GPA never
   * enter the average) is not "countable": it can never fail the exam
   * and never joins the GPA denominator. */
  is_countable: boolean;
  is_fourth_subject: boolean;
}

export interface OverallResult {
  total_marks: number;
  /** 0 when `is_fail` — a failed result has no meaningful GPA, not a
   * partial one. */
  gpa: number;
  grade: string;
  is_fail: boolean;
}

/**
 * The fail rule (D5): one failed countable subject fails the whole
 * result and caps the GPA at 0 — BD NCTB has no partial-credit GPA for a
 * result containing a fail. `gradeForGpa` looks up the overall
 * letter grade from the same scale, keyed by the computed GPA rather
 * than a percentage (the certificate's grade always mirrors the GPA
 * scale, not a re-averaged percent).
 */
export function combineSubjects(
  subjects: SubjectResult[],
  gradeForGpa: (gpa: number) => Band | null,
): OverallResult {
  const total_marks = subjects.reduce((sum, s) => sum + s.obtained, 0);
  const countableAll = subjects.filter((s) => s.is_countable && !s.is_fourth_subject);
  const fourth = subjects.find((s) => s.is_fourth_subject && s.is_countable) ?? null;

  // [pr-fix #945] A failed fourth subject removes only its own bonus, not
  // the whole result — the BD NCTB rule the fourth subject exists under
  // (D14) never fails a student over their *optional* subject. Only the
  // compulsory (non-fourth) countable subjects can fail the result.
  // Checked over every countable subject, including one with no GPA (an
  // ABSENT subject's `gpa` is null too) — a failed-but-ungraded subject
  // must still fail the result, so this check runs before the GPA-average
  // filter below drops it for having nothing to average.
  const anyFail = countableAll.some((s) => s.is_fail);
  if (anyFail) {
    return { total_marks, gpa: 0, grade: 'F', is_fail: true };
  }

  // `gpa !== null` here excludes a subject with nothing to grade (every
  // component EXEMPT, D10) the same way a graded-only subject is excluded
  // — neither has a number to average. A failed subject never reaches
  // this line: the check above already returned.
  const countable = countableAll.filter((s) => s.gpa !== null);
  if (countable.length === 0) {
    return { total_marks, gpa: 0, grade: '-', is_fail: false };
  }

  const mainSum = countable.reduce((sum, s) => sum + (s.gpa ?? 0), 0);
  // The fourth subject's bonus is added to the sum before dividing by the
  // *compulsory* subject count, not averaged in as its own addend — a
  // bonus that shrinks as more compulsory subjects are taken would be
  // backwards from what D14 intends. A failing fourth subject (checked
  // directly, not inferred from its GPA) contributes no bonus at all,
  // rather than relying on a failing band's `gpa` happening to be 0.
  const bonus = fourth && !fourth.is_fail ? fourthSubjectContribution(fourth.gpa) : 0;
  // BD NCTB has no GPA above 5.00 — the fourth-subject bonus can otherwise
  // push a near-perfect compulsory average over the scale's own ceiling.
  const gpa = Math.min(5, roundHalfUp2((mainSum + bonus) / countable.length));

  const band = gradeForGpa(gpa);
  return { total_marks, gpa, grade: band?.grade ?? 'F', is_fail: false };
}

// --- Class position (D18) ---

/**
 * Standard competition ranking ("1224") by GPA descending — two students
 * on the same GPA share the same position, and the next position skips
 * to account for them (1, 2, 2, 4, not 1, 2, 2, 3). A failed student has
 * no position (`null`): ranking a fail is meaningless and this repo has
 * no "last place" convention to invent one.
 */
export function rankByGpa(
  students: Array<{ student_id: string; gpa: number; is_fail: boolean }>,
): Map<string, number | null> {
  const positions = new Map<string, number | null>();
  const ranked = students.filter((s) => !s.is_fail).sort((a, b) => b.gpa - a.gpa);

  let position = 0;
  let previousGpa: number | null = null;
  for (let i = 0; i < ranked.length; i++) {
    if (ranked[i].gpa !== previousGpa) {
      position = i + 1;
      previousGpa = ranked[i].gpa;
    }
    positions.set(ranked[i].student_id, position);
  }
  for (const student of students) {
    if (student.is_fail) positions.set(student.student_id, null);
  }
  return positions;
}
