import { describe, it, expect, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MarkGridService } from './mark-grid.service';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Mark } from './entities/mark.entity';
import { MarkGrid } from './entities/mark-grid.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { Enrollment } from '../students/entities/enrollment.entity';
import { ClassSubject } from '../academics/entities/class-subject.entity';
import { StudentSubjectChoice } from '../students/entities/student-subject-choice.entity';
import { AttendanceComponentService } from './attendance-component.service';
import { MarksAuthorizationService } from './marks-authorization.util';
import { AuditService } from '../audit/audit.service';
import { ExamStatus, MarkGridState, UserRole } from '@biddaloy/shared';

// effectiveSittingDate runs raw SQL; the rule itself (joinedAfterExam) stays real.
const sitting = vi.hoisted(() => ({ date: null as string | null }));
vi.mock('./exam-cohort', async (orig) => ({
  ...(await orig<typeof import('./exam-cohort')>()),
  effectiveSittingDate: vi.fn(async () => sitting.date),
}));

const TENANT_ID = 'tenant-1';
const EXAM_ID = 'exam-1';
const SECTION_ID = 'section-1';
const SUBJECT_ID = 'subject-1';

async function buildService(
  opts: {
    exam?: any;
    section?: any;
    students?: any[];
    enrollments?: any[];
    components?: any[];
    marks?: any[];
    grid?: any;
  } = {},
) {
  const {
    exam = {
      id: EXAM_ID,
      tenant_id: TENANT_ID,
      class_id: 'class-1',
      academic_year_id: 'year-1',
      status: ExamStatus.DRAFT,
    },
    section = { id: SECTION_ID, tenant_id: TENANT_ID, section_name: 'A' },
    students = [],
    enrollments,
    components = [],
    marks = [],
    grid = null,
  } = opts;

  const examRepo: any = { findOne: vi.fn(async () => exam) };
  const componentRepo: any = { find: vi.fn(async () => components) };
  const markRepo: any = { find: vi.fn(async () => marks) };
  const gridRepo: any = {
    findOne: vi.fn(async () => grid),
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: 'grid-1', ...v })),
    update: vi.fn(async () => undefined),
    find: vi.fn(async () => (grid ? [grid] : [])),
    // lockGrid's locked re-read: the existing row, or the DRAFT row it
    // just inserted for a never-touched grid.
    findOneOrFail: vi.fn(async () => ({ id: 'grid-1', state: MarkGridState.DRAFT, ...grid })),
    createQueryBuilder: () => insertQb,
  };
  const insertQb: any = {
    insert: () => insertQb,
    into: () => insertQb,
    values: () => insertQb,
    orIgnore: () => insertQb,
    execute: vi.fn(async () => undefined),
  };
  gridRepo.manager = {
    transaction: vi.fn(async (cb: any) => cb(gridRepo.manager)),
    getRepository: (entity: unknown) =>
      entity === Enrollment
        ? enrollmentRepo
        : entity === Student
          ? studentRepo
          : entity === ExamComponent
            ? componentRepo
            : entity === Mark
              ? markRepo
              : entity === ClassSubject || entity === StudentSubjectChoice
                ? { find: vi.fn(async () => []) }
                : gridRepo,
    createQueryBuilder: () => insertQb,
  };
  const sectionRepo: any = {
    findOne: vi.fn(async () => section),
    find: vi.fn(async () => [section]),
  };
  const studentRepo: any = { find: vi.fn(async () => students) };
  // D17: getGrid's roster comes from Enrollment (exam's year/class,
  // section_id = sectionId), not studentRepo.find directly.
  const enrollmentRepo: any = {
    find: vi.fn(async () =>
      (enrollments ?? students.map((s: any) => ({ student_id: s.id, section_id: SECTION_ID }))).map(
        (e: any) => ({ enrolled_at: new Date('2020-01-01'), ...e }),
      ),
    ),
  };
  const attendanceComponentService = {
    computeForSection: vi.fn(async () => ({ reason: null, valuesByStudent: new Map() })),
  };
  const authz = {
    assertCanWrite: vi.fn(async () => undefined),
    assertCanRead: vi.fn(async () => undefined),
    writableSubjects: vi.fn(async (): Promise<Map<string, Set<string>> | null> => null),
  };
  const auditService = { record: vi.fn(async () => undefined) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      MarkGridService,
      { provide: getRepositoryToken(Exam), useValue: examRepo },
      { provide: getRepositoryToken(ExamComponent), useValue: componentRepo },
      { provide: getRepositoryToken(Mark), useValue: markRepo },
      { provide: getRepositoryToken(MarkGrid), useValue: gridRepo },
      { provide: getRepositoryToken(ClassSection), useValue: sectionRepo },
      { provide: getRepositoryToken(Student), useValue: studentRepo },
      { provide: getRepositoryToken(Enrollment), useValue: enrollmentRepo },
      { provide: AttendanceComponentService, useValue: attendanceComponentService },
      { provide: MarksAuthorizationService, useValue: authz },
      { provide: AuditService, useValue: auditService },
    ],
  }).compile();

  return {
    service: moduleRef.get(MarkGridService),
    examRepo,
    componentRepo,
    markRepo,
    gridRepo,
    sectionRepo,
    studentRepo,
    enrollmentRepo,
    attendanceComponentService,
    authz,
    auditService,
  };
}

describe('MarkGridService.getGrid', () => {
  it('composes students, components, marks, state and derived attendance in one call', async () => {
    const { service } = await buildService({
      students: [{ id: 'stu-1', roll_number: 1, full_name: 'A' }],
      components: [
        {
          id: 'comp-1',
          name: 'Written',
          kind: 'WRITTEN',
          source: 'MANUAL',
          full_marks: '100',
          pass_marks: null,
          sequence: 1,
        },
      ],
      marks: [{ student_id: 'stu-1', component_id: 'comp-1', value: '80.00', status: 'PRESENT' }],
    });

    const grid = await service.getGrid(
      EXAM_ID,
      SECTION_ID,
      SUBJECT_ID,
      TENANT_ID,
      UserRole.ADMIN,
      'user-1',
    );

    expect(grid.state).toBe(MarkGridState.DRAFT);
    expect(grid.students).toEqual([
      { id: 'stu-1', roll_number: 1, full_name: 'A', joined_after_exam: false, not_taking: false },
    ]);
    expect(grid.components).toHaveLength(1);
    expect(grid.cells).toEqual([
      { student_id: 'stu-1', component_id: 'comp-1', value: '80.00', status: 'PRESENT' },
    ]);
  });

  it('includes a derived-attendance breakdown per DERIVED component', async () => {
    const { service, attendanceComponentService } = await buildService({
      components: [
        {
          id: 'comp-att',
          name: 'Attendance',
          kind: 'ATTENDANCE',
          source: 'DERIVED',
          full_marks: '10',
          pass_marks: null,
          sequence: 2,
        },
      ],
    });
    attendanceComponentService.computeForSection = vi.fn(async () => ({
      reason: null,
      valuesByStudent: new Map([['stu-1', '9.50']]),
    }));

    const grid = await service.getGrid(
      EXAM_ID,
      SECTION_ID,
      SUBJECT_ID,
      TENANT_ID,
      UserRole.ADMIN,
      'user-1',
    );

    expect(grid.derived['comp-att']).toEqual({ reason: null, values: { 'stu-1': '9.50' } });
  });
  it('never returns a mark belonging to a student in another section (cross-section leak)', async () => {
    const { service } = await buildService({
      students: [{ id: 'stu-1', roll_number: 1, full_name: 'A' }],
      components: [
        {
          id: 'comp-1',
          name: 'Written',
          kind: 'WRITTEN',
          source: 'MANUAL',
          full_marks: '100',
          pass_marks: null,
          sequence: 1,
        },
      ],
      // Mark has no section column, so the repo returns marks for every
      // section sharing this exam+subject — stu-2 is not in this section.
      marks: [
        { student_id: 'stu-1', component_id: 'comp-1', value: '80.00', status: 'PRESENT' },
        { student_id: 'stu-2', component_id: 'comp-1', value: '55.00', status: 'PRESENT' },
      ],
    });

    const grid = await service.getGrid(
      EXAM_ID,
      SECTION_ID,
      SUBJECT_ID,
      TENANT_ID,
      UserRole.ADMIN,
      'user-1',
    );

    expect(grid.cells).toEqual([
      { student_id: 'stu-1', component_id: 'comp-1', value: '80.00', status: 'PRESENT' },
    ]);
  });
});

const MANUAL = (id: string) => ({ id, source: 'MANUAL', subject_id: SUBJECT_ID });
const STUDENT = (id: string) => ({ id, roll_number: 1, full_name: id });

describe('MarkGridService.submit blank cells (ACAD-04)', () => {
  const submit = (service: MarkGridService) =>
    service.submit(
      EXAM_ID,
      { section_id: SECTION_ID, subject_id: SUBJECT_ID } as any,
      TENANT_ID,
      UserRole.TEACHER,
      'user-1',
    );

  it('refuses with GRID_INCOMPLETE when a cell was never entered', async () => {
    const { service, auditService } = await buildService({
      students: [STUDENT('s1')],
      components: [MANUAL('c1')],
    });
    await expect(submit(service)).rejects.toMatchObject({
      response: { details: { code: 'GRID_INCOMPLETE', blank_count: 1 } },
    });
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('refuses a PRESENT cell with a null value', async () => {
    const { service } = await buildService({
      students: [STUDENT('s1')],
      components: [MANUAL('c1')],
      marks: [{ student_id: 's1', component_id: 'c1', value: null, status: 'PRESENT' }],
    });
    await expect(submit(service)).rejects.toThrow(ConflictException);
  });

  it('accepts ABSENT, EXEMPT and PRESENT+value cells', async () => {
    const { service } = await buildService({
      students: [STUDENT('s1'), STUDENT('s2'), STUDENT('s3')],
      components: [MANUAL('c1')],
      marks: [
        { student_id: 's1', component_id: 'c1', value: null, status: 'ABSENT' },
        { student_id: 's2', component_id: 'c1', value: null, status: 'EXEMPT' },
        { student_id: 's3', component_id: 'c1', value: '5.00', status: 'PRESENT' },
      ],
    });
    await expect(submit(service)).resolves.toMatchObject({ state: MarkGridState.SUBMITTED });
  });

  it('ignores late joiners', async () => {
    sitting.date = '2024-03-01';
    const { service } = await buildService({
      students: [STUDENT('s1')],
      enrollments: [
        { student_id: 's1', section_id: SECTION_ID, enrolled_at: new Date('2024-06-01') },
      ],
      components: [MANUAL('c1')],
    });
    await expect(submit(service)).resolves.toMatchObject({ state: MarkGridState.SUBMITTED });
    sitting.date = null;
  });
});

describe('MarkGridService.submit (D12)', () => {
  it('moves DRAFT -> SUBMITTED and audits it', async () => {
    const { service, gridRepo, auditService } = await buildService();

    const grid = await service.submit(
      EXAM_ID,
      { section_id: SECTION_ID, subject_id: SUBJECT_ID } as any,
      TENANT_ID,
      UserRole.TEACHER,
      'user-1',
    );

    expect(grid.state).toBe(MarkGridState.SUBMITTED);
    expect(gridRepo.manager.transaction).toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalled();
  });

  it('refuses to submit an exam that is already PUBLISHED', async () => {
    const { service } = await buildService({
      exam: { id: EXAM_ID, tenant_id: TENANT_ID, class_id: 'c1', status: ExamStatus.PUBLISHED },
    });

    await expect(
      service.submit(
        EXAM_ID,
        { section_id: SECTION_ID, subject_id: SUBJECT_ID } as any,
        TENANT_ID,
        UserRole.ADMIN,
        'user-1',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses to submit an already-submitted grid', async () => {
    const { service } = await buildService({
      grid: {
        id: 'grid-1',
        state: MarkGridState.SUBMITTED,
        submitted_by: 'user-0',
        submitted_at: new Date(),
      },
    });

    await expect(
      service.submit(
        EXAM_ID,
        { section_id: SECTION_ID, subject_id: SUBJECT_ID } as any,
        TENANT_ID,
        UserRole.TEACHER,
        'user-1',
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('MarkGridService.reopen (D12, admin-only, audited)', () => {
  it('moves SUBMITTED -> DRAFT for an admin and audits it', async () => {
    const submittedAt = new Date();
    const { service, gridRepo, auditService } = await buildService({
      grid: {
        id: 'grid-1',
        state: MarkGridState.SUBMITTED,
        submitted_by: 'user-0',
        submitted_at: submittedAt,
      },
    });

    const grid = await service.reopen(
      EXAM_ID,
      { section_id: SECTION_ID, subject_id: SUBJECT_ID } as any,
      TENANT_ID,
      UserRole.ADMIN,
      'admin-1',
    );

    expect(grid.state).toBe(MarkGridState.DRAFT);
    expect(gridRepo.update).toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalled();
  });

  it('rejects a non-admin caller', async () => {
    const { service } = await buildService({
      grid: {
        id: 'grid-1',
        state: MarkGridState.SUBMITTED,
        submitted_by: 'user-0',
        submitted_at: new Date(),
      },
    });

    await expect(
      service.reopen(
        EXAM_ID,
        { section_id: SECTION_ID, subject_id: SUBJECT_ID } as any,
        TENANT_ID,
        UserRole.TEACHER,
        'user-1',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses to reopen a grid on an exam that is already PUBLISHED', async () => {
    const { service } = await buildService({
      exam: { id: EXAM_ID, tenant_id: TENANT_ID, class_id: 'c1', status: ExamStatus.PUBLISHED },
      grid: {
        id: 'grid-1',
        state: MarkGridState.SUBMITTED,
        submitted_by: 'user-0',
        submitted_at: new Date(),
      },
    });

    await expect(
      service.reopen(
        EXAM_ID,
        { section_id: SECTION_ID, subject_id: SUBJECT_ID } as any,
        TENANT_ID,
        UserRole.ADMIN,
        'admin-1',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects reopening a grid that was never submitted', async () => {
    const { service } = await buildService({ grid: null });

    await expect(
      service.reopen(
        EXAM_ID,
        { section_id: SECTION_ID, subject_id: SUBJECT_ID } as any,
        TENANT_ID,
        UserRole.ADMIN,
        'admin-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('MarkGridService.progress', () => {
  it('counts grids by state and lists outstanding section-subjects', async () => {
    const { service } = await buildService({
      section: { id: SECTION_ID, tenant_id: TENANT_ID, section_name: 'A' },
      components: [
        {
          id: 'comp-1',
          subject_id: SUBJECT_ID,
          subject: { tenant_id: TENANT_ID, name_en: 'Mathematics', name_bn: 'গণিত' },
        },
      ],
      grid: null,
    });

    const result = await service.progress(EXAM_ID, TENANT_ID, undefined, null);

    expect(result.counts[MarkGridState.DRAFT]).toBe(1);
    expect(result.counts[MarkGridState.SUBMITTED]).toBe(0);
    expect(result.outstanding).toEqual([
      {
        section_id: SECTION_ID,
        section_name: 'A',
        subject_id: SUBJECT_ID,
        subject_name: 'Mathematics',
        subject_name_bn: 'গণিত',
        state: MarkGridState.DRAFT,
      },
    ]);
  });

  it('never names a subject from another tenant', async () => {
    const { service } = await buildService({
      section: { id: SECTION_ID, tenant_id: TENANT_ID, section_name: 'A' },
      components: [
        {
          id: 'comp-1',
          subject_id: SUBJECT_ID,
          subject: { tenant_id: 'tenant-b', name_en: 'Secret', name_bn: 'গোপন' },
        },
      ],
      grid: null,
    });

    const result = await service.progress(EXAM_ID, TENANT_ID, undefined, null);

    expect(result.outstanding[0]).toMatchObject({ subject_name: null, subject_name_bn: null });
    expect(result.counts[MarkGridState.DRAFT]).toBe(1);
  });

  it('a SUBMITTED grid is counted and excluded from outstanding', async () => {
    const { service } = await buildService({
      section: { id: SECTION_ID, tenant_id: TENANT_ID, section_name: 'A' },
      components: [{ id: 'comp-1', subject_id: SUBJECT_ID }],
      grid: { section_id: SECTION_ID, subject_id: SUBJECT_ID, state: MarkGridState.SUBMITTED },
    });

    const result = await service.progress(EXAM_ID, TENANT_ID, undefined, null);

    expect(result.counts[MarkGridState.SUBMITTED]).toBe(1);
    expect(result.outstanding).toEqual([]);
  });
});

// D33/D44: a teacher's progress lists and counts only the (section, subject) grids they may write.
describe('MarkGridService.progress for a teacher', () => {
  it('drops every (section, subject) the teacher cannot write and recomputes the counts', async () => {
    const { service, sectionRepo, authz } = await buildService({
      components: [
        { id: 'comp-1', subject_id: SUBJECT_ID },
        { id: 'comp-2', subject_id: 'subj-other' },
      ],
    });
    sectionRepo.find.mockResolvedValue([
      { id: 'sec-mine', tenant_id: TENANT_ID, section_name: 'A' },
      { id: 'sec-other', tenant_id: TENANT_ID, section_name: 'B' },
    ]);
    authz.writableSubjects.mockResolvedValue(
      new Map([
        ['sec-mine', new Set([SUBJECT_ID])],
        ['sec-other', new Set<string>()],
      ]),
    );

    const result = await service.progress(EXAM_ID, TENANT_ID, undefined, {
      role: UserRole.TEACHER,
      userId: 'teacher-1',
    });

    expect(authz.writableSubjects).toHaveBeenCalledWith(
      { role: UserRole.TEACHER, userId: 'teacher-1', tenantId: TENANT_ID },
      ['sec-mine', 'sec-other'],
    );
    expect(result.counts[MarkGridState.DRAFT]).toBe(1);
    expect(result.outstanding.map((o) => `${o.section_id}:${o.subject_id}`)).toEqual([
      `sec-mine:${SUBJECT_ID}`,
    ]);
  });
});

describe('MarkGridService.progress with blank cells (X-06)', () => {
  const base = {
    section: { id: SECTION_ID, tenant_id: TENANT_ID, section_name: 'A' },
    grid: { section_id: SECTION_ID, subject_id: SUBJECT_ID, state: MarkGridState.SUBMITTED },
  };

  it('lists a SUBMITTED grid with a blank MANUAL cell as outstanding, state SUBMITTED', async () => {
    const { service } = await buildService({
      ...base,
      students: [STUDENT('s1')],
      components: [{ ...MANUAL('c1'), subject: { tenant_id: TENANT_ID } }],
    });
    const result = await service.progress(EXAM_ID, TENANT_ID, undefined, null);
    expect(result.outstanding).toHaveLength(1);
    expect(result.outstanding[0].state).toBe(MarkGridState.SUBMITTED);
    expect(result.counts[MarkGridState.SUBMITTED]).toBe(1);
  });

  it('does not list a SUBMITTED grid whose only blanks belong to a late joiner', async () => {
    sitting.date = '2024-03-01';
    const { service } = await buildService({
      ...base,
      students: [STUDENT('s1')],
      enrollments: [
        { student_id: 's1', section_id: SECTION_ID, enrolled_at: new Date('2024-06-01') },
      ],
      components: [{ ...MANUAL('c1'), subject: { tenant_id: TENANT_ID } }],
    });
    const result = await service.progress(EXAM_ID, TENANT_ID, undefined, null);
    sitting.date = null;
    expect(result.outstanding).toEqual([]);
  });
});
