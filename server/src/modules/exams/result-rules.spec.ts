import { describe, it, expect } from 'vitest';
import { MarkStatus } from '@biddaloy/shared';
import {
  computeSubjectTotal,
  gradeSubjectTotal,
  fourthSubjectContribution,
  combineSubjects,
  rankByGpa,
  roundHalfUp2,
  Band,
  SubjectResult,
} from './result-rules';

/** BD NCTB bands, hand-written — 80-100 A+ 5.00 down to 0-32 F 0.00. */
const NCTB_BANDS: Band[] = [
  { percent_from: 80, percent_to: 100, grade: 'A+', gpa: 5.0, is_fail: false },
  { percent_from: 70, percent_to: 79, grade: 'A', gpa: 4.0, is_fail: false },
  { percent_from: 60, percent_to: 69, grade: 'A-', gpa: 3.5, is_fail: false },
  { percent_from: 50, percent_to: 59, grade: 'B', gpa: 3.0, is_fail: false },
  { percent_from: 40, percent_to: 49, grade: 'C', gpa: 2.0, is_fail: false },
  { percent_from: 33, percent_to: 39, grade: 'D', gpa: 1.0, is_fail: false },
  { percent_from: 0, percent_to: 32, grade: 'F', gpa: 0.0, is_fail: true },
];

function gradeForPercent(percent: number): Band | null {
  const rounded = Math.floor(percent + 0.5);
  return NCTB_BANDS.find((b) => rounded >= b.percent_from && rounded <= b.percent_to) ?? null;
}

function gradeForGpa(gpa: number): Band | null {
  const eligible = NCTB_BANDS.filter((b) => b.gpa !== null && b.gpa <= gpa);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, b) => ((b.gpa as number) > (best.gpa as number) ? b : best));
}

/** One subject, straight from raw component marks to its graded outcome
 * — the whole pipeline `results.service.ts` runs per subject. */
function gradeSubject(
  subjectId: string,
  components: { full_marks: number; value: number | null; status: MarkStatus }[],
  opts: { isFourth?: boolean; isCountable?: boolean } = {},
): SubjectResult {
  const total = computeSubjectTotal(components);
  const graded = gradeSubjectTotal(total, gradeForPercent);
  return {
    subject_id: subjectId,
    obtained: total.obtained,
    full_marks: total.full_marks,
    is_countable: opts.isCountable ?? true,
    is_fourth_subject: opts.isFourth ?? false,
    ...graded,
  };
}

describe('computeSubjectTotal (D10)', () => {
  it('sums PRESENT components straightforwardly', () => {
    const total = computeSubjectTotal([
      { full_marks: 70, value: 60, status: MarkStatus.PRESENT },
      { full_marks: 30, value: 25, status: MarkStatus.PRESENT },
    ]);
    expect(total).toEqual({ obtained: 85, full_marks: 100, percent: 85, is_absent: false });
  });

  it('ABSENT on any component fails the whole subject, not a 0% mark', () => {
    const total = computeSubjectTotal([
      { full_marks: 70, value: null, status: MarkStatus.ABSENT },
      { full_marks: 30, value: 25, status: MarkStatus.PRESENT },
    ]);
    expect(total.is_absent).toBe(true);
    expect(total.full_marks).toBe(0);
  });

  it('EXEMPT drops a component from both numerator and denominator', () => {
    const total = computeSubjectTotal([
      { full_marks: 70, value: 60, status: MarkStatus.PRESENT },
      { full_marks: 30, value: null, status: MarkStatus.EXEMPT },
    ]);
    // Only the 70-mark written component counts — as if the exempt
    // practical component never existed for this subject.
    expect(total).toEqual({
      obtained: 60,
      full_marks: 70,
      percent: (60 / 70) * 100,
      is_absent: false,
    });
  });

  it('every component exempt leaves nothing to grade', () => {
    const total = computeSubjectTotal([{ full_marks: 30, value: null, status: MarkStatus.EXEMPT }]);
    expect(total).toEqual({ obtained: 0, full_marks: 0, percent: 0, is_absent: false });
  });
});

describe('fourthSubjectContribution (D14)', () => {
  it('contributes GPA above 2.0 only', () => {
    expect(fourthSubjectContribution(5.0)).toBe(3.0);
    expect(fourthSubjectContribution(3.5)).toBe(1.5);
  });

  it('contributes nothing at or below 2.0 — never a penalty', () => {
    expect(fourthSubjectContribution(2.0)).toBe(0);
    expect(fourthSubjectContribution(1.0)).toBe(0);
    expect(fourthSubjectContribution(0)).toBe(0);
  });

  it('contributes nothing when the subject has no GPA (e.g. failed)', () => {
    expect(fourthSubjectContribution(null)).toBe(0);
  });
});

describe('combineSubjects (D5 fail rule) — hand-written GPA table', () => {
  it('a clean pass across five subjects averages their GPAs exactly', () => {
    const subjects = [
      gradeSubject('math', [{ full_marks: 100, value: 85, status: MarkStatus.PRESENT }]), // A+ 5.00
      gradeSubject('eng', [{ full_marks: 100, value: 72, status: MarkStatus.PRESENT }]), // A 4.00
      gradeSubject('sci', [{ full_marks: 100, value: 65, status: MarkStatus.PRESENT }]), // A- 3.50
      gradeSubject('ban', [{ full_marks: 100, value: 55, status: MarkStatus.PRESENT }]), // B 3.00
      gradeSubject('rel', [{ full_marks: 100, value: 45, status: MarkStatus.PRESENT }]), // C 2.00
    ];
    const result = combineSubjects(subjects, gradeForGpa);
    // (5 + 4 + 3.5 + 3 + 2) / 5 = 3.5
    expect(result).toEqual({ total_marks: 322, gpa: 3.5, grade: 'A-', is_fail: false });
  });

  it('a single failed countable subject fails the whole result and caps GPA at 0', () => {
    const subjects = [
      gradeSubject('math', [{ full_marks: 100, value: 85, status: MarkStatus.PRESENT }]), // A+
      gradeSubject('eng', [{ full_marks: 100, value: 20, status: MarkStatus.PRESENT }]), // F
    ];
    const result = combineSubjects(subjects, gradeForGpa);
    expect(result).toEqual({ total_marks: 105, gpa: 0, grade: 'F', is_fail: true });
  });

  it('ABSENT in a countable subject fails the result the same way', () => {
    const subjects = [
      gradeSubject('math', [{ full_marks: 100, value: 85, status: MarkStatus.PRESENT }]),
      gradeSubject('eng', [{ full_marks: 100, value: null, status: MarkStatus.ABSENT }]),
    ];
    const result = combineSubjects(subjects, gradeForGpa);
    expect(result.is_fail).toBe(true);
    expect(result.gpa).toBe(0);
    expect(result.grade).toBe('F');
  });

  it('an exempt subject is dropped from the GPA average entirely', () => {
    const subjects = [
      gradeSubject('math', [{ full_marks: 100, value: 85, status: MarkStatus.PRESENT }]), // A+ 5.00
      gradeSubject('pe', [{ full_marks: 50, value: null, status: MarkStatus.EXEMPT }]), // exempt, not countable-failing
      gradeSubject('eng', [{ full_marks: 100, value: 72, status: MarkStatus.PRESENT }]), // A 4.00
    ];
    const result = combineSubjects(subjects, gradeForGpa);
    // (5 + 4) / 2 = 4.5 — the exempt subject never enters the average.
    expect(result).toEqual({ total_marks: 157, gpa: 4.5, grade: 'A', is_fail: false });
  });

  it('a fourth subject above 2.0 adds its excess GPA on top of the average', () => {
    const subjects = [
      gradeSubject('math', [{ full_marks: 100, value: 72, status: MarkStatus.PRESENT }]), // A 4.00
      gradeSubject('eng', [{ full_marks: 100, value: 72, status: MarkStatus.PRESENT }]), // A 4.00
      gradeSubject(
        'extra',
        [{ full_marks: 100, value: 85, status: MarkStatus.PRESENT }], // A+ 5.00
        { isFourth: true },
      ),
    ];
    const result = combineSubjects(subjects, gradeForGpa);
    // base average (4 + 4) / 2 = 4.0, plus fourth's (5.0 - 2.0) = 3.0 bonus = 7.0,
    // clamped by nothing here (a real scale tops out at 5.0 band lookup,
    // but the raw GPA number itself is allowed to exceed 5.0 — BD NCTB's
    // actual published results do show >5.00 before the 5.00 cap some
    // boards apply; this repo's grading scale doesn't model that cap, so
    // this function doesn't invent one either).
    expect(result.gpa).toBe(7.0);
    expect(result.is_fail).toBe(false);
  });

  it('a fourth subject at or below 2.0 contributes nothing — same as not taking one', () => {
    const withLowFourth = combineSubjects(
      [
        gradeSubject('math', [{ full_marks: 100, value: 72, status: MarkStatus.PRESENT }]),
        gradeSubject('eng', [{ full_marks: 100, value: 72, status: MarkStatus.PRESENT }]),
        gradeSubject('extra', [{ full_marks: 100, value: 45, status: MarkStatus.PRESENT }], {
          isFourth: true,
        }), // C 2.00
      ],
      gradeForGpa,
    );
    const withoutFourth = combineSubjects(
      [
        gradeSubject('math', [{ full_marks: 100, value: 72, status: MarkStatus.PRESENT }]),
        gradeSubject('eng', [{ full_marks: 100, value: 72, status: MarkStatus.PRESENT }]),
      ],
      gradeForGpa,
    );
    expect(withLowFourth.gpa).toBe(withoutFourth.gpa);
  });

  it('a failed fourth subject fails the whole result too', () => {
    const result = combineSubjects(
      [
        gradeSubject('math', [{ full_marks: 100, value: 85, status: MarkStatus.PRESENT }]),
        gradeSubject('extra', [{ full_marks: 100, value: 10, status: MarkStatus.PRESENT }], {
          isFourth: true,
        }), // F
      ],
      gradeForGpa,
    );
    expect(result.is_fail).toBe(true);
    expect(result.gpa).toBe(0);
  });

  it('a graded-not-marked subject shows a grade but never joins the GPA average', () => {
    const gradedOnly = gradeSubject(
      'conduct',
      [{ full_marks: 100, value: 60, status: MarkStatus.PRESENT }], // A-
      { isCountable: false },
    );
    const subjects = [
      gradeSubject('math', [{ full_marks: 100, value: 72, status: MarkStatus.PRESENT }]), // A 4.00
      gradeSubject('eng', [{ full_marks: 100, value: 88, status: MarkStatus.PRESENT }]), // A+ 5.00
      gradedOnly,
    ];
    const result = combineSubjects(subjects, gradeForGpa);
    // (4 + 5) / 2 = 4.5 — conduct's A- never dilutes the average.
    expect(result.gpa).toBe(4.5);
    expect(gradedOnly.grade).toBe('A-');
  });

  it('a failed graded-not-marked subject does not fail the whole result', () => {
    const gradedOnly = gradeSubject(
      'conduct',
      [{ full_marks: 100, value: 10, status: MarkStatus.PRESENT }],
      {
        isCountable: false,
      },
    );
    const subjects = [
      gradeSubject('math', [{ full_marks: 100, value: 72, status: MarkStatus.PRESENT }]),
      gradedOnly,
    ];
    const result = combineSubjects(subjects, gradeForGpa);
    expect(result.is_fail).toBe(false);
  });
});

describe('rankByGpa (D18)', () => {
  it('ranks strictly descending with no ties', () => {
    const positions = rankByGpa([
      { student_id: 's1', gpa: 5.0, is_fail: false },
      { student_id: 's2', gpa: 4.0, is_fail: false },
      { student_id: 's3', gpa: 3.0, is_fail: false },
    ]);
    expect(positions.get('s1')).toBe(1);
    expect(positions.get('s2')).toBe(2);
    expect(positions.get('s3')).toBe(3);
  });

  it('ties share a position and the next position skips (1, 2, 2, 4)', () => {
    const positions = rankByGpa([
      { student_id: 's1', gpa: 5.0, is_fail: false },
      { student_id: 's2', gpa: 4.0, is_fail: false },
      { student_id: 's3', gpa: 4.0, is_fail: false },
      { student_id: 's4', gpa: 3.0, is_fail: false },
    ]);
    expect(positions.get('s1')).toBe(1);
    expect(positions.get('s2')).toBe(2);
    expect(positions.get('s3')).toBe(2);
    expect(positions.get('s4')).toBe(4);
  });

  it('a failed student has no position', () => {
    const positions = rankByGpa([
      { student_id: 's1', gpa: 5.0, is_fail: false },
      { student_id: 's2', gpa: 0, is_fail: true },
    ]);
    expect(positions.get('s1')).toBe(1);
    expect(positions.get('s2')).toBeNull();
  });
});

describe('roundHalfUp2', () => {
  it('rounds .5 up at the second decimal, spelled out explicitly', () => {
    expect(roundHalfUp2(3.145)).toBe(3.15);
    expect(roundHalfUp2(3.144)).toBe(3.14);
    expect(roundHalfUp2(0)).toBe(0);
  });

  it('is not fooled by plain float multiplication landing just under the boundary (pr-fix #945)', () => {
    // 8.005 * 100 === 800.4999999999999 in plain JS float arithmetic —
    // decimal exponent shifting must round this up to 8.01, not down.
    expect(roundHalfUp2(8.005)).toBe(8.01);
  });

  it('normalizes a negative-zero result to plain zero', () => {
    expect(Object.is(roundHalfUp2(-0.001), -0)).toBe(false);
    expect(roundHalfUp2(-0.001)).toBe(0);
  });
});
