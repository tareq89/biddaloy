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

/** D7 — mean GPA desc, then summed total desc as the tie-break, then
 * `student_id` so a full tie still ranks the same every time. The input
 * comes from an unordered query, and `merit_rank` drives section
 * placement and roll numbers, so without the last key a `refresh()` could
 * swap two tied students' sections or rolls with nothing else changed. */
export function meritOrder(rows: MeritRow[]): RankedMeritRow[] {
  const sorted = [...rows].sort((a, b) => {
    if (b.mean_gpa !== a.mean_gpa) return b.mean_gpa - a.mean_gpa;
    if (b.total_marks_sum !== a.total_marks_sum) return b.total_marks_sum - a.total_marks_sum;
    return a.student_id < b.student_id ? -1 : a.student_id > b.student_id ? 1 : 0;
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
  /** M3 — students already enrolled in this section who aren't part of the
   * incoming cohort (they get renumbered, not evicted, at commit). Counts
   * against capacity so a full section doesn't silently overflow. */
  occupied_count?: number;
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
 * section is eligible for everyone. A `capacity: null` section is
 * genuinely uncapped: `ceil(n / eligibleSections)` only balances the
 * first pass across it, and any student the main pass couldn't place is
 * swept into an uncapped section afterward if one exists. BLOCK fills
 * sections in order to capacity before moving to the next; SNAKE
 * round-robins back and forth. Students who don't fit anywhere (no
 * uncapped section left, once every capped one is full) get
 * `OVER_CAPACITY`; students with no eligible section at all get
 * `NO_ELIGIBLE_SECTION`.
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
    // M3 — subtract existing occupants (renumbered, not evicted, at commit)
    // from an EXPLICIT capacity only: a `capacity: 40` section with 10
    // occupants really only has 30 free seats. A `capacity: null` section
    // is uncapped by definition — evenSplit only heuristically divides the
    // INCOMING cohort across it and isn't a real limit, so occupants there
    // don't take budget away from it (they're just also present).
    const remaining = cohortSections.map((s) =>
      s.capacity !== null ? s.capacity - (s.occupied_count ?? 0) : evenSplit,
    );

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
      // L1 — a bounded-but-generous budget per student, not a counter
      // shared across the whole cohort: a shared counter can be exhausted
      // by uneven section sizes long before every seat is actually
      // checked, producing a false OVER_CAPACITY. snakeIndices repeats
      // its endpoint index on the turnaround (…,n-1,n-1,…,0,0,…), so a
      // window has to cover a full bounce (2n) rather than just n to be
      // guaranteed to visit every index at least once.
      const maxAttemptsPerStudent = cohortSections.length * 2;
      for (const student of cohort.students) {
        let placed = false;
        for (let attempt = 0; attempt < maxAttemptsPerStudent; attempt++) {
          const { value } = generator.next();
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

    // Rescue pass — `evenSplit` is a balancing heuristic for uncapped
    // sections, not a real limit (see the comment above). In a mixed
    // cohort, capped sections can fill before an uncapped one is anywhere
    // near full, wrongly flagging the overflow as OVER_CAPACITY even
    // though an uncapped section exists. Sweep any such student into an
    // uncapped section, round-robin, clearing the false error.
    const uncapped = cohortSections.filter((s) => s.capacity === null);
    if (uncapped.length > 0) {
      let k = 0;
      for (const student of cohort.students) {
        if (errors[student.student_id] !== 'OVER_CAPACITY') continue;
        const section = uncapped[k % uncapped.length];
        k++;
        assignments[student.student_id] = section.id;
        delete errors[student.student_id];
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
