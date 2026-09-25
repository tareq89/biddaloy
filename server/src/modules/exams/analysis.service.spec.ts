import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ExamStatus } from '@biddaloy/shared';
import { AnalysisService } from './analysis.service';

const TENANT_ID = 'tenant-1';
const EXAM_ID = 'exam-1';
const SECTION_ID = 'section-1';

/** A chainable TypeORM query-builder stub: every builder method returns
 * itself, and `getRawMany`/`getRawOne` are pre-seeded per test. Real
 * ordering/filtering happens in Postgres — these tests exercise the
 * service's mapping and arithmetic on top of what a query would return,
 * not the SQL itself. */
function makeQb(
  rawMany: Record<string, unknown>[] = [],
  rawOne: Record<string, unknown> | null = null,
) {
  const qb: any = {};
  const chain = [
    'innerJoin',
    'leftJoin',
    'where',
    'andWhere',
    'select',
    'addSelect',
    'groupBy',
    'addGroupBy',
    'orderBy',
    'addOrderBy',
  ];
  for (const m of chain) qb[m] = vi.fn(() => qb);
  qb.getRawMany = vi.fn(async () => rawMany);
  qb.getRawOne = vi.fn(async () => rawOne);
  return qb;
}

function makeService(opts: {
  exam?: Record<string, unknown> | null;
  resultQbQueue?: any[];
  resultSubjectQbQueue?: any[];
  markQbQueue?: any[];
}) {
  const exam = { id: EXAM_ID, tenant_id: TENANT_ID, status: ExamStatus.PROCESSED, ...opts.exam };
  const examRepo: any = { findOne: vi.fn(async () => (opts.exam === null ? null : exam)) };

  const resultQueue = [...(opts.resultQbQueue ?? [])];
  const resultRepo: any = { createQueryBuilder: vi.fn(() => resultQueue.shift() ?? makeQb()) };

  const rsQueue = [...(opts.resultSubjectQbQueue ?? [])];
  const resultSubjectRepo: any = { createQueryBuilder: vi.fn(() => rsQueue.shift() ?? makeQb()) };

  const markQueue = [...(opts.markQbQueue ?? [])];
  const markRepo: any = { createQueryBuilder: vi.fn(() => markQueue.shift() ?? makeQb()) };

  return new AnalysisService(examRepo, resultRepo, resultSubjectRepo, markRepo);
}

describe('AnalysisService', () => {
  it('throws NotFoundException when the exam is not in the tenant', async () => {
    const service = makeService({ exam: null });
    await expect(service.getMerit(EXAM_ID, TENANT_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns empty rows with the status while the exam is DRAFT', async () => {
    const service = makeService({ exam: { status: ExamStatus.DRAFT } });
    const result = await service.getMerit(EXAM_ID, TENANT_ID);
    expect(result).toEqual({ status: ExamStatus.DRAFT, rows: [] });
  });

  it('merit: maps rows in the order the query returns, section-scoped', async () => {
    const raw = [
      {
        student_id: 's1',
        roll_number: '2',
        full_name: 'Bela',
        section_id: SECTION_ID,
        section_name: 'A',
        total_marks: '450.00',
        gpa: '5.00',
        grade: 'A+',
        position: '2',
        section_position: '1',
        is_fail: false,
      },
      {
        student_id: 's2',
        roll_number: '1',
        full_name: 'Amin',
        section_id: SECTION_ID,
        section_name: 'A',
        total_marks: '440.00',
        gpa: '4.80',
        grade: 'A',
        position: '3',
        section_position: '2',
        is_fail: false,
      },
    ];
    const qb = makeQb(raw);
    const service = makeService({ resultQbQueue: [qb] });
    const result = await service.getMerit(EXAM_ID, TENANT_ID, SECTION_ID);
    expect(result.status).toBe(ExamStatus.PROCESSED);
    expect(result.rows.map((r) => r.student_id)).toEqual(['s1', 's2']);
    expect(result.rows[0].section_position).toBe(1);
    expect(result.rows[0].total_marks).toBe(450);
    // The stub returns rows in seeded order regardless of what's asked for,
    // so without these assertions this test would still pass even if the
    // service dropped the section filter or the ORDER BY.
    expect(qb.andWhere).toHaveBeenCalledWith('r.section_id = :sectionId', {
      sectionId: SECTION_ID,
    });
    expect(qb.orderBy).toHaveBeenCalledWith('r.section_position', 'ASC', 'NULLS LAST');
    expect(qb.addOrderBy).toHaveBeenCalledWith('s.full_name', 'ASC');
  });

  it('defaulted: an ABS-only (not is_fail) student is still included with an absent reason', async () => {
    const meritRaw = [
      {
        result_id: 'r1',
        student_id: 's1',
        roll_number: '5',
        full_name: 'Karim',
        section_id: null,
        section_name: null,
        total_marks: '380.00',
        gpa: '3.50',
        grade: 'B',
        position: '4',
        section_position: null,
        is_fail: false,
      },
    ];
    const subjectRaw = [{ result_id: 'r1', subject_id: 'subj-1', name: 'Physics', grade: 'ABS' }];
    const service = makeService({
      resultQbQueue: [makeQb(meritRaw)],
      resultSubjectQbQueue: [makeQb(subjectRaw)],
    });
    const result = await service.getDefaulted(EXAM_ID, TENANT_ID);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].is_fail).toBe(false);
    expect(result.rows[0].absent_subjects).toEqual([{ subject_id: 'subj-1', name: 'Physics' }]);
    expect(result.rows[0].failed_subjects).toEqual([]);
  });

  it('pass-fail: excludes an absent student from the pass-% denominator', async () => {
    const subjectRaw = [
      {
        subject_id: 'subj-1',
        subject_name: 'Math',
        appeared: '4',
        passed: '3',
        failed: '1',
        absent: '1',
        highest: '95.00',
        average: '70.00',
      },
    ];
    const distRaw = [
      { subject_id: 'subj-1', grade: 'A+', count: '1' },
      { subject_id: 'subj-1', grade: 'A', count: '2' },
      { subject_id: 'subj-1', grade: 'F', count: '1' },
    ];
    const overallRaw = {
      appeared: '5',
      passed: '4',
      failed: '1',
      highest: '480.00',
      average: '400.00',
    };
    const overallDistRaw = [
      { grade: 'A+', count: '1' },
      { grade: 'A', count: '3' },
      { grade: 'F', count: '1' },
    ];
    const service = makeService({
      resultSubjectQbQueue: [makeQb(subjectRaw), makeQb(distRaw)],
      resultQbQueue: [makeQb([], overallRaw), makeQb(overallDistRaw)],
    });
    const result = await service.getPassFail(EXAM_ID, TENANT_ID);
    // 3 passed / 4 appeared (the absent one is excluded from the denominator)
    expect(result.subjects[0].pass_pct).toBe(75);
    expect(result.subjects[0].appeared).toBe(4);
    // grade distribution sums to `appeared`
    const distSum = Object.values(result.subjects[0].grade_distribution).reduce((a, b) => a + b, 0);
    expect(distSum).toBe(result.subjects[0].appeared);
  });

  it('components: below_pass is null when the component has no pass_marks', async () => {
    const raw = [
      {
        subject_id: 'subj-1',
        subject_name: 'Math',
        component_id: 'comp-1',
        component_name: 'Written',
        sequence: '1',
        pass_marks: null,
        appeared: '10',
        absent: '0',
        below_pass: '0',
        highest: '95.00',
        average: '70.00',
      },
      {
        subject_id: 'subj-1',
        subject_name: 'Math',
        component_id: 'comp-2',
        component_name: 'MCQ',
        sequence: '2',
        pass_marks: '10.00',
        appeared: '10',
        absent: '0',
        below_pass: '3',
        highest: '25.00',
        average: '18.00',
      },
    ];
    const service = makeService({ markQbQueue: [makeQb(raw)] });
    const result = await service.getPassFailComponents(EXAM_ID, TENANT_ID);
    expect(result.rows[0].below_pass).toBeNull();
    expect(result.rows[1].below_pass).toBe(3);
  });
});
