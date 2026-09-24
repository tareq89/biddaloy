/**
 * [788] Pure placement/merit functions for the promotion module, in the
 * style of `exams/result-rules.ts` (D25): no repository, no DI, nothing
 * but arithmetic and array shuffling. `promotions.service.ts` is the only
 * caller that touches a database.
 */

import { PromotionOutcome, PlacementAlgorithm } from '@biddaloy/shared';

/** D6 — passing every selected exam suggests PROMOTE, otherwise RETAIN. */
export function suggestOutcome(passedAll: boolean): PromotionOutcome {
  return passedAll ? PromotionOutcome.PROMOTE : PromotionOutcome.RETAIN;
}

export interface MeritRow {
  student_id: string;
  mean_gpa: number;
  total_marks_sum: number;
}

export interface RankedMeritRow extends MeritRow {
  merit_rank: number;
}

/** D7 — mean GPA desc, then summed total desc as the tie-break. */
export function meritOrder(rows: MeritRow[]): RankedMeritRow[] {
  const sorted = [...rows].sort((a, b) => {
    if (b.mean_gpa !== a.mean_gpa) return b.mean_gpa - a.mean_gpa;
    return b.total_marks_sum - a.total_marks_sum;
  });
  return sorted.map((row, index) => ({ ...row, merit_rank: index + 1 }));
}

export interface PlacementStudent {
  student_id: string;
  group_name: string | null;
}

export interface PlacementSection {
  id: string;
  section_name: string;
  capacity: number | null;
  group_name: string | null;
}

export type PlacementErrorCode = 'OVER_CAPACITY' | 'NO_ELIGIBLE_SECTION';

export interface PlacementResult {
  assignments: Record<string, string | null>;
  errors: Record<string, PlacementErrorCode>;
}

/**
 * Infinite-ish bouncing sequence of section indices: 0,1,2,...,n-1,n-1,...,1,0,0,1,...
 * ("A B C C B A") — how SNAKE deals across sections. Used only to generate
 * as many indices as needed for the cohort being placed.
 */
function* snakeIndices(n: number): Generator<number> {
  if (n <= 0) return;
  let i = 0;
  let direction = 1;
  while (true) {
    yield i;
    if (n === 1) continue;
    const next = i + direction;
    if (next < 0 || next >= n) {
      direction *= -1;
    } else {
      i = next;
    }
  }
}

/**
 * D8/D9/D16 — places PROMOTE-bound students (already in merit order) into
 * next-year sections. Students are eligible for sections sharing their
 * `group_name`; if no target section carries a group at all, every
 * section is eligible for everyone. A `capacity: null` section splits its
 * cohort evenly (`ceil(n / eligibleSections)`). BLOCK fills sections in
 * order to capacity before moving to the next; SNAKE round-robins back
 * and forth. Students who don't fit anywhere get `OVER_CAPACITY`;
 * students with no eligible section at all get `NO_ELIGIBLE_SECTION`.
 */
export function place(
  students: PlacementStudent[],
  sections: PlacementSection[],
  algorithm: PlacementAlgorithm,
): PlacementResult {
  const assignments: Record<string, string | null> = {};
  const errors: Record<string, PlacementErrorCode> = {};

  const hasAnyGroup = sections.some((s) => s.group_name !== null);

  // Group students into cohorts that share the same eligible-section set
  // (keyed by the sorted list of eligible section ids), preserving the
  // merit order they arrived in.
  const cohorts = new Map<string, { sections: PlacementSection[]; students: PlacementStudent[] }>();

  for (const student of students) {
    const eligible = hasAnyGroup
      ? sections.filter((s) => s.group_name === student.group_name)
      : sections;

    if (eligible.length === 0) {
      assignments[student.student_id] = null;
      errors[student.student_id] = 'NO_ELIGIBLE_SECTION';
      continue;
    }

    const key = eligible
      .map((s) => s.id)
      .sort()
      .join(',');
    let cohort = cohorts.get(key);
    if (!cohort) {
      cohort = { sections: eligible, students: [] };
      cohorts.set(key, cohort);
    }
    cohort.students.push(student);
  }

  for (const cohort of cohorts.values()) {
    const cohortSections = cohort.sections;
    const n = cohort.students.length;
    const evenSplit = Math.ceil(n / cohortSections.length);
    const remaining = cohortSections.map((s) => s.capacity ?? evenSplit);

    if (algorithm === PlacementAlgorithm.BLOCK) {
      let idx = 0;
      for (const student of cohort.students) {
        while (idx < cohortSections.length && remaining[idx] <= 0) idx++;
        if (idx >= cohortSections.length) {
          assignments[student.student_id] = null;
          errors[student.student_id] = 'OVER_CAPACITY';
          continue;
        }
        assignments[student.student_id] = cohortSections[idx].id;
        remaining[idx]--;
      }
    } else {
      const generator = snakeIndices(cohortSections.length);
      let guard = 0;
      const maxAttempts = cohortSections.reduce((sum, _, i) => sum + Math.max(remaining[i], 0), 0) * 4 + 100;
      for (const student of cohort.students) {
        let placed = false;
        while (guard < maxAttempts) {
          const { value } = generator.next();
          guard++;
          if (value === undefined) break;
          if (remaining[value] > 0) {
            assignments[student.student_id] = cohortSections[value].id;
            remaining[value]--;
            placed = true;
            break;
          }
        }
        if (!placed) {
          assignments[student.student_id] = null;
          errors[student.student_id] = 'OVER_CAPACITY';
        }
      }
    }
  }

  return { assignments, errors };
}

/**
 * D9 — rolls 1..n per section, in the merit order the students were
 * placed in. `students` must already be in merit order (the same order
 * passed to `place`).
 */
export function assignRolls(
  students: PlacementStudent[],
  assignments: Record<string, string | null>,
): Record<string, number> {
  const rolls: Record<string, number> = {};
  const counters = new Map<string, number>();
  for (const student of students) {
    const sectionId = assignments[student.student_id];
    if (!sectionId) continue;
    const next = (counters.get(sectionId) ?? 0) + 1;
    counters.set(sectionId, next);
    rolls[student.student_id] = next;
  }
  return rolls;
}
