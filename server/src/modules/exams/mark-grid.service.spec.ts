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
import { AttendanceComponentService } from './attendance-component.service';
import { MarksAuthorizationService } from './marks-authorization.util';
import { AuditService } from '../audit/audit.service';
import { ExamStatus, MarkGridState, UserRole } from '@biddaloy/shared';

const TENANT_ID = 'tenant-1';
const EXAM_ID = 'exam-1';
const SECTION_ID = 'section-1';
const SUBJECT_ID = 'subject-1';

async function buildService(
  opts: {
    exam?: any;
    section?: any;
    students?: any[];
    components?: any[];
    marks?: any[];
    grid?: any;
  } = {},
) {
  const {
    exam = { id: EXAM_ID, tenant_id: TENANT_ID, class_id: 'class-1', status: ExamStatus.DRAFT },
    section = { id: SECTION_ID, tenant_id: TENANT_ID, section_name: 'A' },
    students = [],
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
  };
  gridRepo.manager = {
    transaction: vi.fn(async (cb: any) => cb({ getRepository: () => gridRepo })),
  };
  const sectionRepo: any = {
    findOne: vi.fn(async () => section),
    find: vi.fn(async () => [section]),
  };
  const studentRepo: any = { find: vi.fn(async () => students) };
  const attendanceComponentService = {
    computeForSection: vi.fn(async () => ({ reason: null, valuesByStudent: new Map() })),
  };
  const authz = { assertCanWrite: vi.fn(async () => undefined) };
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

    const grid = await service.getGrid(EXAM_ID, SECTION_ID, SUBJECT_ID, TENANT_ID);

    expect(grid.state).toBe(MarkGridState.DRAFT);
    expect(grid.students).toEqual([{ id: 'stu-1', roll_number: 1, full_name: 'A' }]);
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

    const grid = await service.getGrid(EXAM_ID, SECTION_ID, SUBJECT_ID, TENANT_ID);

    expect(grid.derived['comp-att']).toEqual({ reason: null, values: { 'stu-1': '9.50' } });
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
      components: [{ id: 'comp-1', subject_id: SUBJECT_ID }],
      grid: null,
    });

    const result = await service.progress(EXAM_ID, TENANT_ID);

    expect(result.counts[MarkGridState.DRAFT]).toBe(1);
    expect(result.counts[MarkGridState.SUBMITTED]).toBe(0);
    expect(result.outstanding).toEqual([
      {
        section_id: SECTION_ID,
        section_name: 'A',
        subject_id: SUBJECT_ID,
        state: MarkGridState.DRAFT,
      },
    ]);
  });

  it('a SUBMITTED grid is counted and excluded from outstanding', async () => {
    const { service } = await buildService({
      section: { id: SECTION_ID, tenant_id: TENANT_ID, section_name: 'A' },
      components: [{ id: 'comp-1', subject_id: SUBJECT_ID }],
      grid: { section_id: SECTION_ID, subject_id: SUBJECT_ID, state: MarkGridState.SUBMITTED },
    });

    const result = await service.progress(EXAM_ID, TENANT_ID);

    expect(result.counts[MarkGridState.SUBMITTED]).toBe(1);
    expect(result.outstanding).toEqual([]);
  });
});
