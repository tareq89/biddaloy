import { describe, it, expect } from 'vitest';
import { PlacementAlgorithm, PromotionOutcome } from '@biddaloy/shared';
import {
  suggestOutcome,
  meritOrder,
  place,
  assignRolls,
  type PlacementStudent,
  type PlacementSection,
} from './placement';

function students(n: number, group: string | null = null): PlacementStudent[] {
  return Array.from({ length: n }, (_, i) => ({ student_id: `s${i + 1}`, group_name: group }));
}

function sections(
  defs: Array<{
    id: string;
    section_name: string;
    capacity: number | null;
    group_name?: string | null;
  }>,
): PlacementSection[] {
  return defs.map((d) => ({ group_name: null, ...d }));
}

describe('suggestOutcome', () => {
  it('suggests PROMOTE when all exams passed', () => {
    expect(suggestOutcome(true)).toBe(PromotionOutcome.PROMOTE);
  });

  it('suggests RETAIN when not all exams passed', () => {
    expect(suggestOutcome(false)).toBe(PromotionOutcome.RETAIN);
  });
});

describe('meritOrder', () => {
  it('sorts by mean GPA descending', () => {
    const ranked = meritOrder([
      { student_id: 'a', mean_gpa: 3.0, total_marks_sum: 100 },
      { student_id: 'b', mean_gpa: 4.5, total_marks_sum: 100 },
      { student_id: 'c', mean_gpa: 3.8, total_marks_sum: 100 },
    ]);
    expect(ranked.map((r) => r.student_id)).toEqual(['b', 'c', 'a']);
    expect(ranked.map((r) => r.merit_rank)).toEqual([1, 2, 3]);
  });

  it('tie-breaks equal GPA on summed total descending', () => {
    const ranked = meritOrder([
      { student_id: 'a', mean_gpa: 4.0, total_marks_sum: 400 },
      { student_id: 'b', mean_gpa: 4.0, total_marks_sum: 450 },
    ]);
    expect(ranked.map((r) => r.student_id)).toEqual(['b', 'a']);
  });

  it('ranks a full tie the same whatever order the rows arrive in', () => {
    const x = { student_id: 'x', mean_gpa: 4.0, total_marks_sum: 400 };
    const y = { student_id: 'y', mean_gpa: 4.0, total_marks_sum: 400 };
    const forward = meritOrder([x, y]);
    const reverse = meritOrder([y, x]);
    expect(forward.map((r) => [r.student_id, r.merit_rank])).toEqual([
      ['x', 1],
      ['y', 2],
    ]);
    expect(reverse.map((r) => [r.student_id, r.merit_rank])).toEqual([
      ['x', 1],
      ['y', 2],
    ]);
  });
});

describe('place', () => {
  it('BLOCK fills sections in order to capacity', () => {
    const s = students(7);
    const sec = sections([
      { id: 'A', section_name: 'A', capacity: 3 },
      { id: 'B', section_name: 'B', capacity: 3 },
      { id: 'C', section_name: 'C', capacity: 3 },
    ]);
    const { assignments, errors } = place(s, sec, PlacementAlgorithm.BLOCK);
    expect(errors).toEqual({});
    expect(['s1', 's2', 's3'].map((id) => assignments[id])).toEqual(['A', 'A', 'A']);
    expect(['s4', 's5', 's6'].map((id) => assignments[id])).toEqual(['B', 'B', 'B']);
    expect(assignments['s7']).toBe('C');
  });

  it('SNAKE deals A B C C B A', () => {
    const s = students(6);
    const sec = sections([
      { id: 'A', section_name: 'A', capacity: 2 },
      { id: 'B', section_name: 'B', capacity: 2 },
      { id: 'C', section_name: 'C', capacity: 2 },
    ]);
    const { assignments } = place(s, sec, PlacementAlgorithm.SNAKE);
    expect(['s1', 's2', 's3', 's4', 's5', 's6'].map((id) => assignments[id])).toEqual([
      'A',
      'B',
      'C',
      'C',
      'B',
      'A',
    ]);
  });

  it('respects capacity and flags overflow as OVER_CAPACITY', () => {
    const s = students(4);
    const sec = sections([{ id: 'A', section_name: 'A', capacity: 3 }]);
    const { assignments, errors } = place(s, sec, PlacementAlgorithm.BLOCK);
    expect(['s1', 's2', 's3'].map((id) => assignments[id])).toEqual(['A', 'A', 'A']);
    expect(assignments['s4']).toBeNull();
    expect(errors['s4']).toBe('OVER_CAPACITY');
  });

  it('BLOCK rescues OVER_CAPACITY students into an uncapped section when one exists', () => {
    const s = students(10);
    const sec = sections([
      { id: 'A', section_name: 'A', capacity: 1 },
      { id: 'B', section_name: 'B', capacity: null },
    ]);
    const { assignments, errors } = place(s, sec, PlacementAlgorithm.BLOCK);
    expect(errors).toEqual({});
    const countA = Object.values(assignments).filter((v) => v === 'A').length;
    const countB = Object.values(assignments).filter((v) => v === 'B').length;
    expect(countA).toBe(1);
    expect(countB).toBe(9);
  });

  it('SNAKE rescues OVER_CAPACITY students into an uncapped section when one exists', () => {
    const s = students(10);
    const sec = sections([
      { id: 'A', section_name: 'A', capacity: 1 },
      { id: 'B', section_name: 'B', capacity: null },
    ]);
    const { assignments, errors } = place(s, sec, PlacementAlgorithm.SNAKE);
    expect(errors).toEqual({});
    const countA = Object.values(assignments).filter((v) => v === 'A').length;
    const countB = Object.values(assignments).filter((v) => v === 'B').length;
    expect(countA).toBe(1);
    expect(countB).toBe(9);
  });

  it('null capacity splits the cohort evenly (ceil)', () => {
    const s = students(7);
    const sec = sections([
      { id: 'A', section_name: 'A', capacity: null },
      { id: 'B', section_name: 'B', capacity: null },
    ]);
    // ceil(7/2) = 4 per section
    const { assignments, errors } = place(s, sec, PlacementAlgorithm.BLOCK);
    expect(errors).toEqual({});
    const countA = Object.values(assignments).filter((v) => v === 'A').length;
    const countB = Object.values(assignments).filter((v) => v === 'B').length;
    expect(countA).toBe(4);
    expect(countB).toBe(3);
  });

  it('a student is only eligible for sections sharing their group', () => {
    const s: PlacementStudent[] = [
      { student_id: 's1', group_name: 'Science' },
      { student_id: 's2', group_name: 'Arts' },
    ];
    const sec = sections([
      { id: 'A', section_name: 'A', capacity: 5, group_name: 'Science' },
      { id: 'B', section_name: 'B', capacity: 5, group_name: 'Arts' },
    ]);
    const { assignments, errors } = place(s, sec, PlacementAlgorithm.BLOCK);
    expect(assignments['s1']).toBe('A');
    expect(assignments['s2']).toBe('B');
    expect(errors).toEqual({});
  });

  it('flags NO_ELIGIBLE_SECTION when a student has no matching group', () => {
    const s: PlacementStudent[] = [{ student_id: 's1', group_name: 'Commerce' }];
    const sec = sections([{ id: 'A', section_name: 'A', capacity: 5, group_name: 'Science' }]);
    const { assignments, errors } = place(s, sec, PlacementAlgorithm.BLOCK);
    expect(assignments['s1']).toBeNull();
    expect(errors['s1']).toBe('NO_ELIGIBLE_SECTION');
  });

  it('when no target section carries a group, all sections are eligible for everyone', () => {
    const s = students(2, 'Science');
    const sec = sections([
      { id: 'A', section_name: 'A', capacity: 5, group_name: null },
      { id: 'B', section_name: 'B', capacity: 5, group_name: null },
    ]);
    const { assignments, errors } = place(s, sec, PlacementAlgorithm.BLOCK);
    expect(errors).toEqual({});
    expect(assignments['s1']).toBe('A');
  });

  // M3 — a section with existing occupants (renumbered, not evicted, at
  // commit) must not accept more incoming students than its remaining seats.
  it('subtracts existing occupants from an explicit capacity', () => {
    const s = students(2);
    const sec: PlacementSection[] = [
      { id: 'A', section_name: 'A', capacity: 3, group_name: null, occupied_count: 2 },
    ];
    const { assignments, errors } = place(s, sec, PlacementAlgorithm.BLOCK);
    expect(assignments['s1']).toBe('A'); // 1 seat left
    expect(assignments['s2']).toBeNull();
    expect(errors['s2']).toBe('OVER_CAPACITY');
  });

  it('does not subtract occupants from a null (uncapped) section — evenSplit only divides the incoming cohort', () => {
    const s = students(4);
    const sec: PlacementSection[] = [
      { id: 'A', section_name: 'A', capacity: null, group_name: null, occupied_count: 5 },
      { id: 'B', section_name: 'B', capacity: null, group_name: null, occupied_count: 0 },
    ];
    // null capacity is uncapped by definition; an existing occupant there
    // doesn't block the incoming cohort's even split.
    const { assignments, errors } = place(s, sec, PlacementAlgorithm.BLOCK);
    expect(errors).toEqual({});
    const countA = Object.values(assignments).filter((v) => v === 'A').length;
    expect(countA).toBe(2); // ceil(4/2) = 2, unaffected by occupied_count
  });

  // L1 — an unevenly-sized cohort (some students eligible for very few
  // sections, others for many) must not exhaust a shared attempt budget
  // before every real seat is checked.
  it('SNAKE places a full cohort across very unevenly-sized eligible groups without a false OVER_CAPACITY', () => {
    // 10 sections, one huge cohort with no group constraint — many students,
    // few sections relative to student count, forcing many bounces.
    const s = students(40);
    const sec = sections(
      Array.from({ length: 10 }, (_, i) => ({
        id: `S${i}`,
        section_name: `S${i}`,
        capacity: 4,
      })),
    );
    const { assignments, errors } = place(s, sec, PlacementAlgorithm.SNAKE);
    expect(errors).toEqual({});
    expect(Object.values(assignments).every((v) => v !== null)).toBe(true);
  });
});

describe('assignRolls', () => {
  it('assigns rolls 1..n per section in merit order', () => {
    const s = students(5);
    const sec = sections([{ id: 'A', section_name: 'A', capacity: 5 }]);
    const { assignments } = place(s, sec, PlacementAlgorithm.BLOCK);
    const rolls = assignRolls(s, assignments);
    expect(rolls).toEqual({ s1: 1, s2: 2, s3: 3, s4: 4, s5: 5 });
  });

  it('rolls restart per section', () => {
    const s = students(4);
    const sec = sections([
      { id: 'A', section_name: 'A', capacity: 2 },
      { id: 'B', section_name: 'B', capacity: 2 },
    ]);
    const { assignments } = place(s, sec, PlacementAlgorithm.BLOCK);
    const rolls = assignRolls(s, assignments);
    expect(rolls).toEqual({ s1: 1, s2: 2, s3: 1, s4: 2 });
  });

  it('skips students with no assignment', () => {
    const s = students(2);
    const sec = sections([{ id: 'A', section_name: 'A', capacity: 1 }]);
    const { assignments } = place(s, sec, PlacementAlgorithm.BLOCK);
    const rolls = assignRolls(s, assignments);
    expect(rolls).toEqual({ s1: 1 });
    expect(rolls['s2']).toBeUndefined();
  });
});
