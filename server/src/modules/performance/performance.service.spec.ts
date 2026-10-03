import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@biddaloy/shared';
import { PerformanceService } from './performance.service';

const T = 'tenant-1';
const YEAR = { id: 'y1', start_date: '2026-01-01', end_date: '2026-12-31' };
const admin = { tenantId: T, role: UserRole.ADMIN, userId: 'u1' };
const teacher = { tenantId: T, role: UserRole.TEACHER, userId: 'u2' };
const Q = { academicYearId: 'y1' } as any;
const HW = { totalAssignments: 4, completed: 3, defaulters: 1, completionPercent: 75 };

const pf = (appeared: number, pass_pct: number, average: number | null) => ({
  overall: { appeared, pass_pct, average },
});

describe('PerformanceService', () => {
  let examRepo: any, studentRepo: any, enrollmentRepo: any, classRepo: any, sectionRepo: any;
  let yearRepo: any, termRepo: any, noteRepo: any, qb: any, noteQb: any;
  let analysis: any, attendance: any, homework: any, schools: any;
  let service: PerformanceService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    const chain = (getter: Record<string, any>) => {
      const c: any = { ...getter };
      for (const m of ['innerJoin', 'where', 'andWhere', 'select', 'addSelect'])
        c[m] = vi.fn(() => c);
      return c;
    };
    qb = chain({ getOne: vi.fn(async () => ({ id: 'cs' })) });
    noteQb = chain({ getRawOne: vi.fn(async () => ({ average: null, count: '0' })) });
    examRepo = { find: vi.fn(async () => []) };
    studentRepo = { findOne: vi.fn(async () => ({ id: 's1' })) };
    enrollmentRepo = {
      findOne: vi.fn(async () => ({ class_id: 'c1', section_id: 'sec1' })),
    };
    classRepo = { findOne: vi.fn(async () => ({ id: 'c1' })) };
    sectionRepo = {
      findOne: vi.fn(async () => ({ id: 'sec1' })),
      find: vi.fn(async () => [{ id: 'sec1' }, { id: 'sec2' }, { id: 'sec3' }]),
      createQueryBuilder: vi.fn(() => qb),
    };
    yearRepo = { findOne: vi.fn(async () => YEAR) };
    termRepo = {
      findOne: vi.fn(async () => ({ start_date: '2026-03-01', end_date: '2026-04-30' })),
    };
    noteRepo = { createQueryBuilder: vi.fn(() => noteQb) };
    analysis = { getPassFail: vi.fn(), getMerit: vi.fn(async () => ({ rows: [] })) };
    attendance = {
      getSectionSummary: vi.fn(async () => ({ section_percentage: 80 })),
      getStudentSummary: vi.fn(async () => ({ attendance_percentage: 91 })),
    };
    homework = {
      getSectionRollup: vi.fn(async () => HW),
      getClassRollup: vi.fn(async () => ({ ...HW, syllabus: { totalTopics: 1 } })),
      getStudentRollup: vi.fn(async () => HW),
    };
    schools = { getResolvedSettings: vi.fn(async () => ({ region: { timezone: 'UTC' } })) };
    service = new PerformanceService(
      examRepo,
      studentRepo,
      enrollmentRepo,
      classRepo,
      sectionRepo,
      yearRepo,
      termRepo,
      noteRepo,
      analysis,
      attendance,
      homework,
      schools,
    );
  });

  afterEach(() => vi.useRealTimers());

  const exams = (n: number) =>
    examRepo.find.mockResolvedValue(
      Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, name: `Exam ${i + 1}` })),
    );

  it('class: means over exams, appeared=0 exam listed but not averaged', async () => {
    exams(3);
    analysis.getPassFail
      .mockResolvedValueOnce(pf(10, 80, 60))
      .mockResolvedValueOnce(pf(10, 60, 70.5))
      .mockResolvedValueOnce(pf(0, 0, null));
    const r = await service.getClassPerformance('c1', Q, admin);
    expect(r.passRate).toBe(70);
    expect(r.averageMarks).toBe(65.25);
    expect(r.exams).toHaveLength(3);
  });

  it('class: one exam equals that exam overall exactly', async () => {
    exams(1);
    analysis.getPassFail.mockResolvedValue(pf(7, 66.7, 55.33));
    const r = await service.getClassPerformance('c1', Q, admin);
    expect(r.passRate).toBe(66.7);
    expect(r.averageMarks).toBe(55.33);
  });

  it('class with sectionId uses section services', async () => {
    exams(1);
    analysis.getPassFail.mockResolvedValue(pf(1, 100, 90));
    await service.getClassPerformance('c1', { ...Q, sectionId: 'sec1' }, admin);
    expect(analysis.getPassFail).toHaveBeenCalledWith('e1', T, 'sec1');
    expect(homework.getSectionRollup).toHaveBeenCalled();
    expect(homework.getClassRollup).not.toHaveBeenCalled();
    expect(attendance.getSectionSummary).toHaveBeenCalledTimes(1);
  });

  it('class without sectionId: class rollup, attendance mean skipping null, no syllabus', async () => {
    attendance.getSectionSummary
      .mockResolvedValueOnce({ section_percentage: 90 })
      .mockResolvedValueOnce({ section_percentage: null })
      .mockResolvedValueOnce({ section_percentage: 70 });
    const r = await service.getClassPerformance('c1', Q, admin);
    expect(homework.getClassRollup).toHaveBeenCalled();
    expect(r.attendancePercent).toBe(80);
    expect(r.homework).toEqual(HW);
    expect('syllabus' in r.homework).toBe(false);
  });

  it('student: own merit row, skips exam without row, no sectionId', async () => {
    exams(2);
    analysis.getMerit
      .mockResolvedValueOnce({
        rows: [
          { student_id: 'other', total_marks: 1, gpa: 1, grade: 'F', is_fail: true },
          { student_id: 's1', total_marks: 80, gpa: 4, grade: 'A', is_fail: false },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const r = await service.getStudentPerformance('s1', Q, admin);
    expect(r.exams).toHaveLength(1);
    expect(r.averageMarks).toBe(80);
    expect(r.averageGpa).toBe(4);
    expect(analysis.getMerit).toHaveBeenCalledWith('e1', T);
  });

  it('student: one pass + one fail = 50', async () => {
    exams(2);
    analysis.getMerit
      .mockResolvedValueOnce({
        rows: [{ student_id: 's1', total_marks: 80, gpa: 4, grade: 'A', is_fail: false }],
      })
      .mockResolvedValueOnce({
        rows: [{ student_id: 's1', total_marks: 20, gpa: 0, grade: 'F', is_fail: true }],
      });
    const r = await service.getStudentPerformance('s1', Q, admin);
    expect(r.passRate).toBe(50);
    expect(r.averageGpa).toBe(2);
    expect(r.attendancePercent).toBe(91);
    expect(r.homework).toEqual(HW);
  });

  it('student note rating rounds and handles none', async () => {
    noteQb.getRawOne.mockResolvedValue({ average: '3.6667', count: '3' });
    let r = await service.getStudentPerformance('s1', Q, admin);
    expect(r.noteRatingAverage).toBe(3.67);
    expect(r.noteRatingCount).toBe(3);
    noteQb.getRawOne.mockResolvedValue({ average: null, count: '0' });
    r = await service.getStudentPerformance('s1', Q, admin);
    expect(r.noteRatingAverage).toBeNull();
    expect(r.noteRatingCount).toBe(0);
  });

  it('attendance clamps to today', async () => {
    await service.getStudentPerformance('s1', Q, admin);
    expect(attendance.getStudentSummary).toHaveBeenCalledWith({
      tenantId: T,
      studentId: 's1',
      from: '2026-01-01',
      to: '2026-06-15',
    });
  });

  it('attendance null and not called when year starts after today', async () => {
    yearRepo.findOne.mockResolvedValue({
      ...YEAR,
      start_date: '2027-01-01',
      end_date: '2027-12-31',
    });
    const r = await service.getStudentPerformance('s1', Q, admin);
    expect(r.attendancePercent).toBeNull();
    expect(attendance.getStudentSummary).not.toHaveBeenCalled();
  });

  it('term: dates from term, exam query filtered; foreign term 404s', async () => {
    const r = await service.getClassPerformance('c1', { ...Q, termId: 't1' }, admin);
    expect(r.from).toBe('2026-03-01');
    expect(r.to).toBe('2026-04-30');
    expect(examRepo.find.mock.calls[0][0].where.academic_term_id).toBe('t1');
    termRepo.findOne.mockResolvedValue(null);
    await expect(service.getClassPerformance('c1', { ...Q, termId: 'x' }, admin)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('404: unknown year', async () => {
    yearRepo.findOne.mockResolvedValue(null);
    await expect(service.getClassPerformance('c1', Q, admin)).rejects.toThrow(NotFoundException);
  });

  it('404: unknown student', async () => {
    studentRepo.findOne.mockResolvedValue(null);
    await expect(service.getStudentPerformance('s1', Q, admin)).rejects.toThrow(NotFoundException);
  });

  it('404: no enrollment in year', async () => {
    enrollmentRepo.findOne.mockResolvedValue(null);
    await expect(service.getStudentPerformance('s1', Q, admin)).rejects.toThrow(NotFoundException);
  });

  it('404: section not in class', async () => {
    sectionRepo.findOne.mockResolvedValue(null);
    await expect(
      service.getClassPerformance('c1', { ...Q, sectionId: 'zzz' }, admin),
    ).rejects.toThrow(NotFoundException);
  });

  it('ADMIN and EXECUTIVE skip the teacher join', async () => {
    await service.getClassPerformance('c1', Q, admin);
    await service.getClassPerformance('c1', Q, { ...admin, role: UserRole.EXECUTIVE });
    expect(sectionRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  // [#1362] Per-role table: true = skips the teacher join (tenant-wide); false = 403.
  it.each([
    [UserRole.ADMIN, true],
    [UserRole.EXECUTIVE, true],
    [UserRole.ACCOUNTANT, false],
    // New in #1362: needs tenant data scope AND MARK_VIEW; SUPER_ADMIN is out (D-N).
    [UserRole.SUPER_ADMIN, false],
    [UserRole.EXAM_CONTROLLER, true],
    [UserRole.OFFICE_STAFF, false],
    [UserRole.COMMITTEE, false],
    [UserRole.PARENT, false],
    [UserRole.STUDENT, false],
  ])('%s: tenant-wide=%s', async (role, wide) => {
    const call = service.getClassPerformance('c1', Q, { ...teacher, role });
    if (wide) await expect(call).resolves.toBeDefined();
    else await expect(call).rejects.toThrow(ForbiddenException);
    expect(sectionRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('TEACHER without a matching section gets 403', async () => {
    qb.getOne.mockResolvedValue(null);
    await expect(service.getClassPerformance('c1', Q, teacher)).rejects.toThrow(ForbiddenException);
  });

  it('non-teacher, non-tenant-wide role gets 403 without touching the teacher join', async () => {
    // assertTeacherScope falls through to the final throw for e.g. ACCOUNTANT / PARENT.
    for (const role of [UserRole.ACCOUNTANT, UserRole.PARENT]) {
      await expect(service.getClassPerformance('c1', Q, { ...teacher, role })).rejects.toThrow(
        ForbiddenException,
      );
    }
    expect(sectionRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('student with null section is scope-checked by class', async () => {
    enrollmentRepo.findOne.mockResolvedValue({ class_id: 'c1', section_id: null });
    await service.getStudentPerformance('s1', Q, teacher);
    expect(qb.andWhere).toHaveBeenCalledWith('cs.class_id = :classId', { classId: 'c1' });
  });
});
