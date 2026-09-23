import { describe, it, expect, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MarksService } from './marks.service';
import { Mark } from './entities/mark.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { MarkGrid } from './entities/mark-grid.entity';
import { Exam } from './entities/exam.entity';
import { Student } from '../students/entities/student.entity';
import { MarksAuthorizationService } from './marks-authorization.util';
import { ResultsService } from './results.service';
import { AuditService } from '../audit/audit.service';
import {
  ExamComponentKind,
  ExamComponentSource,
  MarkGridState,
  MarkStatus,
  UserRole,
} from '@biddaloy/shared';

const TENANT_ID = 'tenant-1';
const EXAM_ID = 'exam-1';
const SECTION_ID = 'section-1';
const SUBJECT_ID = 'subject-1';

function component(overrides: Partial<ExamComponent> = {}): ExamComponent {
  return {
    id: 'comp-1',
    tenant_id: TENANT_ID,
    exam_id: EXAM_ID,
    subject_id: SUBJECT_ID,
    name: 'Written',
    kind: ExamComponentKind.WRITTEN,
    source: ExamComponentSource.MANUAL,
    full_marks: '100',
    pass_marks: '33',
    sequence: 1,
    deleted_at: null,
    ...overrides,
  } as ExamComponent;
}

async function buildService(
  opts: {
    components?: ExamComponent[];
    grid?: Partial<MarkGrid> | null;
    existingMarks?: Partial<Mark>[];
    enrolledCount?: number;
  } = {},
) {
  const { components = [component()], grid = null, existingMarks = [], enrolledCount } = opts;

  const markRepo: any = {
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: `id-${Math.random()}`, ...v })),
    update: vi.fn(async () => undefined),
    findOne: vi.fn(async () => null),
    find: vi.fn(async () =>
      existingMarks.map((m) => ({
        updated_at: new Date(),
        value: null,
        status: MarkStatus.PRESENT,
        ...m,
      })),
    ),
  };
  markRepo.manager = {
    transaction: vi.fn(async (cb: any) => cb({ getRepository: () => markRepo })),
  };

  const componentRepo: any = { find: vi.fn(async () => components) };
  const gridRepo: any = { findOne: vi.fn(async () => grid) };
  const examRepo: any = { findOne: vi.fn(async () => ({ id: EXAM_ID, tenant_id: TENANT_ID })) };
  const studentIds = ['stu-1', 'stu-2'];
  const studentRepo: any = {
    count: vi.fn(async ({ where }: any) => enrolledCount ?? (where.id.value as string[]).length),
  };
  const authz = { assertCanWrite: vi.fn(async () => undefined) };
  const resultsService = { recomputeIfProcessed: vi.fn(async () => undefined) };
  const auditService = { record: vi.fn(async () => undefined) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      MarksService,
      { provide: getRepositoryToken(Mark), useValue: markRepo },
      { provide: getRepositoryToken(ExamComponent), useValue: componentRepo },
      { provide: getRepositoryToken(MarkGrid), useValue: gridRepo },
      { provide: getRepositoryToken(Exam), useValue: examRepo },
      { provide: getRepositoryToken(Student), useValue: studentRepo },
      { provide: MarksAuthorizationService, useValue: authz },
      { provide: ResultsService, useValue: resultsService },
      { provide: AuditService, useValue: auditService },
    ],
  }).compile();

  return {
    service: moduleRef.get(MarksService),
    resultsService,
    markRepo,
    componentRepo,
    gridRepo,
    examRepo,
    studentRepo,
    authz,
    auditService,
    studentIds,
  };
}

function batchDto(cells: any[]) {
  return { section_id: SECTION_ID, subject_id: SUBJECT_ID, cells } as any;
}

describe('MarksService.upsertBatch', () => {
  it('creates new cells and returns real server timestamps', async () => {
    const { service, markRepo } = await buildService({
      existingMarks: [
        { student_id: 'stu-1', component_id: 'comp-1', value: '75.00', status: MarkStatus.PRESENT },
      ],
    });

    const result = await service.upsertBatch(
      EXAM_ID,
      batchDto([
        { student_id: 'stu-1', component_id: 'comp-1', value: '75', status: MarkStatus.PRESENT },
      ]),
      TENANT_ID,
      UserRole.TEACHER,
      'user-1',
    );

    expect(markRepo.manager.transaction).toHaveBeenCalled();
    expect(result.cells).toEqual([
      {
        student_id: 'stu-1',
        component_id: 'comp-1',
        value: '75.00',
        status: MarkStatus.PRESENT,
        saved_at: expect.any(Date),
      },
    ]);
  });

  it('overwrites an existing cell (update, not a duplicate insert)', async () => {
    const { service, markRepo } = await buildService({
      existingMarks: [
        { student_id: 'stu-1', component_id: 'comp-1', value: '60.00', status: MarkStatus.PRESENT },
      ],
    });
    markRepo.findOne = vi.fn(async () => ({
      id: 'mark-1',
      student_id: 'stu-1',
      component_id: 'comp-1',
    }));

    await service.upsertBatch(
      EXAM_ID,
      batchDto([
        { student_id: 'stu-1', component_id: 'comp-1', value: '60', status: MarkStatus.PRESENT },
      ]),
      TENANT_ID,
      UserRole.TEACHER,
      'user-1',
    );

    expect(markRepo.update).toHaveBeenCalledWith(
      { id: 'mark-1' },
      { value: '60', status: MarkStatus.PRESENT, entered_by: 'user-1' },
    );
    expect(markRepo.save).not.toHaveBeenCalled();
  });

  it('replaying the same batch is idempotent (no error, same end state)', async () => {
    const { service, markRepo } = await buildService({
      existingMarks: [
        { student_id: 'stu-1', component_id: 'comp-1', value: '75.00', status: MarkStatus.PRESENT },
      ],
    });
    markRepo.findOne = vi.fn(async () => ({
      id: 'mark-1',
      student_id: 'stu-1',
      component_id: 'comp-1',
    }));
    const cells = [
      { student_id: 'stu-1', component_id: 'comp-1', value: '75', status: MarkStatus.PRESENT },
    ];

    await service.upsertBatch(EXAM_ID, batchDto(cells), TENANT_ID, UserRole.TEACHER, 'user-1');
    await expect(
      service.upsertBatch(EXAM_ID, batchDto(cells), TENANT_ID, UserRole.TEACHER, 'user-1'),
    ).resolves.toBeDefined();
  });

  it('rejects a value greater than the component full_marks', async () => {
    const { service } = await buildService();

    await expect(
      service.upsertBatch(
        EXAM_ID,
        batchDto([
          { student_id: 'stu-1', component_id: 'comp-1', value: '150', status: MarkStatus.PRESENT },
        ]),
        TENANT_ID,
        UserRole.TEACHER,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an ABSENT cell carrying a value (D10)', async () => {
    const { service } = await buildService();

    await expect(
      service.upsertBatch(
        EXAM_ID,
        batchDto([
          { student_id: 'stu-1', component_id: 'comp-1', value: '10', status: MarkStatus.ABSENT },
        ]),
        TENANT_ID,
        UserRole.TEACHER,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects writing to a DERIVED component directly', async () => {
    const { service } = await buildService({
      components: [
        component({
          id: 'comp-att',
          kind: 'ATTENDANCE' as any,
          source: ExamComponentSource.DERIVED,
        }),
      ],
    });

    await expect(
      service.upsertBatch(
        EXAM_ID,
        batchDto([
          { student_id: 'stu-1', component_id: 'comp-att', value: '5', status: MarkStatus.PRESENT },
        ]),
        TENANT_ID,
        UserRole.TEACHER,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a write to a SUBMITTED grid, naming who and when', async () => {
    const submittedAt = new Date('2026-01-01T00:00:00Z');
    const { service } = await buildService({
      grid: { state: MarkGridState.SUBMITTED, submitted_by: 'admin-1', submitted_at: submittedAt },
    });

    await expect(
      service.upsertBatch(
        EXAM_ID,
        batchDto([
          { student_id: 'stu-1', component_id: 'comp-1', value: '75', status: MarkStatus.PRESENT },
        ]),
        TENANT_ID,
        UserRole.TEACHER,
        'user-1',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('propagates an authorization rejection (a class teacher with no subject grant)', async () => {
    const { service, authz } = await buildService();
    authz.assertCanWrite = vi.fn(async () => {
      throw new ForbiddenException('not assigned');
    });

    await expect(
      service.upsertBatch(
        EXAM_ID,
        batchDto([
          { student_id: 'stu-1', component_id: 'comp-1', value: '75', status: MarkStatus.PRESENT },
        ]),
        TENANT_ID,
        UserRole.TEACHER,
        'user-1',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a component not found for this exam-subject (IDOR guard)', async () => {
    const { service } = await buildService({ components: [] });

    await expect(
      service.upsertBatch(
        EXAM_ID,
        batchDto([
          {
            student_id: 'stu-1',
            component_id: 'other-tenant-comp',
            value: '10',
            status: MarkStatus.PRESENT,
          },
        ]),
        TENANT_ID,
        UserRole.TEACHER,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a student not enrolled in this section (IDOR guard)', async () => {
    const { service } = await buildService({ enrolledCount: 0 });

    await expect(
      service.upsertBatch(
        EXAM_ID,
        batchDto([
          {
            student_id: 'other-section-student',
            component_id: 'comp-1',
            value: '10',
            status: MarkStatus.PRESENT,
          },
        ]),
        TENANT_ID,
        UserRole.TEACHER,
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("a request for another tenant's exam returns not-found", async () => {
    const { service, examRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => null);

    await expect(
      service.upsertBatch(
        EXAM_ID,
        batchDto([
          { student_id: 'stu-1', component_id: 'comp-1', value: '10', status: MarkStatus.PRESENT },
        ]),
        'other-tenant',
        UserRole.TEACHER,
        'user-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('calls ResultsService.recomputeIfProcessed once per distinct student in the batch (19.5.1 D18)', async () => {
    const { service, resultsService } = await buildService({
      existingMarks: [
        { student_id: 'stu-1', component_id: 'comp-1', value: '75.00', status: MarkStatus.PRESENT },
      ],
    });

    await service.upsertBatch(
      EXAM_ID,
      batchDto([
        { student_id: 'stu-1', component_id: 'comp-1', value: '75', status: MarkStatus.PRESENT },
      ]),
      TENANT_ID,
      UserRole.TEACHER,
      'user-1',
    );

    expect(resultsService.recomputeIfProcessed).toHaveBeenCalledTimes(1);
    expect(resultsService.recomputeIfProcessed).toHaveBeenCalledWith(
      EXAM_ID,
      'stu-1',
      TENANT_ID,
      'user-1',
      { ip: null, userAgent: null },
    );
  });
});
