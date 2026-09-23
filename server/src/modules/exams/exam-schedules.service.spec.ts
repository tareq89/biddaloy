import { describe, it, expect, vi } from 'vitest';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { ExamSchedulesService } from './exam-schedules.service';
import { ExamSchedule } from './entities/exam-schedule.entity';
import { Exam } from './entities/exam.entity';
import { ExamComponent } from './entities/exam-component.entity';
import { Subject } from '../academics/entities/subject.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AuditService } from '../audit/audit.service';

/**
 * Unit tests for 19.11.1's `ExamSchedulesService`: CRUD validation
 * (starts_at < ends_at, date inside the exam's academic year, overlap
 * warning) and the staff/family visibility rule.
 */

const TENANT_ID = 'tenant-1';
const EXAM_ID = 'exam-1';

function scheduleRow(overrides: Partial<ExamSchedule> = {}): ExamSchedule {
  return {
    id: 'sched-1',
    tenant_id: TENANT_ID,
    exam_id: EXAM_ID,
    subject_id: 'subj-1',
    date: '2026-02-05',
    starts_at: '09:00:00',
    ends_at: '11:00:00',
    venue: 'Main Hall',
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    ...overrides,
  } as ExamSchedule;
}

async function buildService(
  opts: {
    existingSchedules?: ExamSchedule[];
    componentSubjectIds?: string[];
    scheduledSubjectIds?: string[];
  } = {},
) {
  const examRepo: any = {
    findOne: vi.fn(async () => ({
      id: EXAM_ID,
      tenant_id: TENANT_ID,
      academic_year_id: 'year-1',
      class_id: 'class-1',
    })),
    find: vi.fn(async () => [{ id: EXAM_ID, tenant_id: TENANT_ID, class_id: 'class-1' }]),
  };

  const scheduleRepo: any = {
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: v.id ?? `id-${Math.random()}`, ...v })),
    update: vi.fn(async () => undefined),
    softDelete: vi.fn(async () => undefined),
    find: vi.fn(async () => opts.existingSchedules ?? []),
    findOne: vi.fn(async () => (opts.existingSchedules ?? [])[0] ?? null),
    createQueryBuilder: vi.fn(() => {
      const ids = opts.scheduledSubjectIds ?? [];
      const qb: any = {
        select: () => qb,
        where: () => qb,
        andWhere: () => qb,
        getRawMany: async () => ids.map((subject_id) => ({ subject_id })),
      };
      return qb;
    }),
  };
  scheduleRepo.manager = {
    transaction: vi.fn(async (cb: any) => cb({ getRepository: () => scheduleRepo })),
  };

  const componentRepo: any = {
    createQueryBuilder: vi.fn(() => {
      const ids = opts.componentSubjectIds ?? [];
      const qb: any = {
        select: () => qb,
        where: () => qb,
        andWhere: () => qb,
        getRawMany: async () => ids.map((subject_id) => ({ subject_id })),
      };
      return qb;
    }),
  };

  const subjectRepo: any = {
    findOne: vi.fn(async ({ where }: any) => ({ id: where.id, tenant_id: where.tenant_id })),
  };

  const yearRepo: any = {
    findOne: vi.fn(async () => ({
      id: 'year-1',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    })),
  };

  const auditService = { record: vi.fn(async () => undefined) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ExamSchedulesService,
      { provide: getRepositoryToken(ExamSchedule), useValue: scheduleRepo },
      { provide: getRepositoryToken(Exam), useValue: examRepo },
      { provide: getRepositoryToken(ExamComponent), useValue: componentRepo },
      { provide: getRepositoryToken(Subject), useValue: subjectRepo },
      { provide: getRepositoryToken(AcademicYear), useValue: yearRepo },
      { provide: AuditService, useValue: auditService },
    ],
  }).compile();

  return {
    service: moduleRef.get(ExamSchedulesService),
    scheduleRepo,
    examRepo,
    yearRepo,
    auditService,
  };
}

describe('ExamSchedulesService CRUD validation', () => {
  it('creates a valid schedule row', async () => {
    const { service, scheduleRepo } = await buildService();

    const { schedule, warnings } = await service.create(
      EXAM_ID,
      { subject_id: 'subj-1', date: '2026-02-05', starts_at: '09:00', ends_at: '11:00' } as any,
      TENANT_ID,
    );

    expect(schedule).toMatchObject({ exam_id: EXAM_ID, subject_id: 'subj-1' });
    expect(warnings).toEqual([]);
    expect(scheduleRepo.save).toHaveBeenCalled();
  });

  it('rejects starts_at >= ends_at', async () => {
    const { service } = await buildService();

    await expect(
      service.create(
        EXAM_ID,
        { subject_id: 'subj-1', date: '2026-02-05', starts_at: '11:00', ends_at: '09:00' } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a date outside the exam academic year', async () => {
    const { service } = await buildService();

    await expect(
      service.create(
        EXAM_ID,
        { subject_id: 'subj-1', date: '2027-02-05', starts_at: '09:00', ends_at: '11:00' } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('warns but still saves when two subjects overlap in time', async () => {
    const { service, scheduleRepo } = await buildService({
      existingSchedules: [
        scheduleRow({
          id: 'sched-other',
          subject_id: 'subj-2',
          starts_at: '10:00',
          ends_at: '12:00',
        }),
      ],
    });

    const { schedule, warnings } = await service.create(
      EXAM_ID,
      { subject_id: 'subj-1', date: '2026-02-05', starts_at: '09:00', ends_at: '11:00' } as any,
      TENANT_ID,
    );

    expect(scheduleRepo.save).toHaveBeenCalled();
    expect(schedule).toBeDefined();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/Overlaps/);
  });

  it('maps a unique-violation to 409', async () => {
    const { service, scheduleRepo } = await buildService();
    scheduleRepo.manager.transaction = vi.fn(async () => {
      const err = new QueryFailedError('insert', [], new Error('duplicate'));
      (err as any).code = '23505';
      throw err;
    });

    await expect(
      service.create(
        EXAM_ID,
        { subject_id: 'subj-1', date: '2026-02-05', starts_at: '09:00', ends_at: '11:00' } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('ExamSchedulesService visibility rule (issue rule #5)', () => {
  it('staff sees an incomplete schedule as soon as any row exists', async () => {
    const { service } = await buildService({
      existingSchedules: [scheduleRow()],
    });

    const rows = await service.listForStaff(EXAM_ID, TENANT_ID);
    expect(rows).toHaveLength(1);
  });

  it('families do not see the schedule until every component-subject has a row', async () => {
    const { service } = await buildService({
      existingSchedules: [scheduleRow({ subject_id: 'subj-1' })],
      componentSubjectIds: ['subj-1', 'subj-2'],
      scheduledSubjectIds: ['subj-1'],
    });

    const rows = await service.listForFamily(EXAM_ID, TENANT_ID);
    expect(rows).toEqual([]);
  });

  it('families see the schedule once every component-subject has a row', async () => {
    const { service } = await buildService({
      existingSchedules: [scheduleRow({ subject_id: 'subj-1' })],
      componentSubjectIds: ['subj-1'],
      scheduledSubjectIds: ['subj-1'],
    });

    const rows = await service.listForFamily(EXAM_ID, TENANT_ID);
    expect(rows).toHaveLength(1);
  });

  it('families see nothing when the exam has no components at all', async () => {
    const { service } = await buildService({
      existingSchedules: [],
      componentSubjectIds: [],
      scheduledSubjectIds: [],
    });

    const rows = await service.listForFamily(EXAM_ID, TENANT_ID);
    expect(rows).toEqual([]);
  });
});
