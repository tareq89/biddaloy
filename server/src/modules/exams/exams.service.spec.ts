import { describe, it, expect, vi } from 'vitest';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { ExamsService } from './exams.service';
import { Exam } from './entities/exam.entity';
import { Mark } from './entities/mark.entity';
import { Class } from '../academics/entities/class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { AuditService } from '../audit/audit.service';
import { ExamKind } from '@biddaloy/shared';

/**
 * Unit tests for 19.3.1's `ExamsService` — exam CRUD, and the "class/year
 * can't change once marks exist" rule (issue rule #1). Tenant isolation is
 * covered by `findOne`'s `tenant_id` filter (same pattern proven by
 * `classes.service.spec.ts`).
 */

const TENANT_ID = 'tenant-1';
const OTHER_TENANT_ID = 'tenant-2';

function createRepoStub() {
  const repo: any = {
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: 'new-id', ...v })),
    update: vi.fn(async () => undefined),
    findOne: vi.fn(async () => null),
    findAndCount: vi.fn(async () => [[], 0]),
    softDelete: vi.fn(async () => undefined),
  };
  repo.manager = {
    transaction: vi.fn(async (cb: any) => cb({ getRepository: () => repo })),
  };
  return repo;
}

async function buildService() {
  const examRepo = createRepoStub();
  const markRepo = { count: vi.fn(async () => 0) };
  // Default: the referenced class exists for the tenant and belongs to
  // academic year 'y1' — matches every existing test's fixture data, so
  // only the IDOR-guard-specific tests below need to override this.
  const classRepo: any = {
    findOne: vi.fn(async ({ where }: any) => ({
      id: where.id,
      tenant_id: where.tenant_id,
      academic_year_id: 'y1',
    })),
  };
  const yearRepo: any = {
    findOne: vi.fn(async ({ where }: any) => ({ id: where.id, tenant_id: where.tenant_id })),
  };
  const termRepo: any = {
    findOne: vi.fn(async ({ where }: any) => ({ id: where.id, tenant_id: where.tenant_id })),
  };
  const auditService = { record: vi.fn(async () => undefined) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      ExamsService,
      { provide: getRepositoryToken(Exam), useValue: examRepo },
      { provide: getRepositoryToken(Mark), useValue: markRepo },
      { provide: getRepositoryToken(Class), useValue: classRepo },
      { provide: getRepositoryToken(AcademicYear), useValue: yearRepo },
      { provide: getRepositoryToken(AcademicTerm), useValue: termRepo },
      { provide: AuditService, useValue: auditService },
    ],
  }).compile();

  return {
    service: moduleRef.get(ExamsService),
    examRepo,
    markRepo,
    classRepo,
    yearRepo,
    termRepo,
    auditService,
  };
}

describe('ExamsService CRUD', () => {
  it('creates an exam scoped to the tenant', async () => {
    const { service, examRepo } = await buildService();

    const exam = await service.create(
      { name: 'Term 1', kind: ExamKind.TERM, academic_year_id: 'y1', class_id: 'c1' } as any,
      TENANT_ID,
    );

    expect(exam).toMatchObject({ name: 'Term 1', tenant_id: TENANT_ID });
    expect(examRepo.save).toHaveBeenCalled();
  });

  it('finds an exam by id, scoped to tenant', async () => {
    const { service, examRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({ id: 'e1', tenant_id: TENANT_ID, name: 'Term 1' }));

    const exam = await service.findOne('e1', TENANT_ID);
    expect(exam).toMatchObject({ id: 'e1' });
  });

  it('lists exams filtered by tenant, year and class', async () => {
    const { service, examRepo } = await buildService();
    examRepo.findAndCount = vi.fn(async () => [[{ id: 'e1' }], 1]);

    const result = await service.findAll(
      { academic_year_id: 'y1', class_id: 'c1' } as any,
      TENANT_ID,
    );

    expect(result).toMatchObject({ data: [{ id: 'e1' }], total: 1 });
    expect(examRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: TENANT_ID,
          academic_year_id: 'y1',
          class_id: 'c1',
        }),
      }),
    );
  });

  it('updates a non-class/year field without checking marks', async () => {
    const { service, examRepo, markRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({
      id: 'e1',
      tenant_id: TENANT_ID,
      class_id: 'c1',
      academic_year_id: 'y1',
      name: 'Old',
    }));

    await service.update('e1', { name: 'New' } as any, TENANT_ID);

    expect(markRepo.count).not.toHaveBeenCalled();
    expect(examRepo.update).toHaveBeenCalledWith(
      { id: 'e1', tenant_id: TENANT_ID },
      { name: 'New' },
    );
  });

  it('deletes (soft) an exam', async () => {
    const { service, examRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({ id: 'e1', tenant_id: TENANT_ID, name: 'Term 1' }));

    await service.remove('e1', TENANT_ID);

    expect(examRepo.softDelete).toHaveBeenCalledWith({ id: 'e1', tenant_id: TENANT_ID });
  });

  it("a request for another tenant's exam returns not-found, never another tenant's row", async () => {
    const { service, examRepo } = await buildService();
    // Repo stub simulates the tenant_id filter: querying as OTHER_TENANT_ID
    // never matches a row that belongs to TENANT_ID.
    examRepo.findOne = vi.fn(async () => null);

    await expect(service.findOne('e1', OTHER_TENANT_ID)).rejects.toThrow(NotFoundException);
  });
});

describe('ExamsService class/year change guard (issue rule #1)', () => {
  it('allows changing class when no marks exist for the exam', async () => {
    const { service, examRepo, markRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({
      id: 'e1',
      tenant_id: TENANT_ID,
      class_id: 'c1',
      academic_year_id: 'y1',
    }));
    markRepo.count = vi.fn(async () => 0);

    await expect(service.update('e1', { class_id: 'c2' } as any, TENANT_ID)).resolves.toBeDefined();
    expect(markRepo.count).toHaveBeenCalledWith({ where: { exam_id: 'e1', tenant_id: TENANT_ID } });
  });

  it('rejects changing class once marks exist for the exam', async () => {
    const { service, examRepo, markRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({
      id: 'e1',
      tenant_id: TENANT_ID,
      class_id: 'c1',
      academic_year_id: 'y1',
    }));
    markRepo.count = vi.fn(async () => 3);

    await expect(service.update('e1', { class_id: 'c2' } as any, TENANT_ID)).rejects.toThrow(
      ConflictException,
    );
    expect(examRepo.update).not.toHaveBeenCalled();
  });

  it('rejects changing academic_year_id once marks exist for the exam', async () => {
    const { service, examRepo, markRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({
      id: 'e1',
      tenant_id: TENANT_ID,
      class_id: 'c1',
      academic_year_id: 'y1',
    }));
    markRepo.count = vi.fn(async () => 1);

    await expect(
      service.update('e1', { academic_year_id: 'y2' } as any, TENANT_ID),
    ).rejects.toThrow(ConflictException);
  });

  it('does not reject when class/year are sent but unchanged', async () => {
    const { service, examRepo, markRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({
      id: 'e1',
      tenant_id: TENANT_ID,
      class_id: 'c1',
      academic_year_id: 'y1',
    }));
    markRepo.count = vi.fn(async () => 5);

    await expect(
      service.update('e1', { class_id: 'c1', academic_year_id: 'y1' } as any, TENANT_ID),
    ).resolves.toBeDefined();
  });
});

describe('ExamsService tenant-reference guard (IDOR)', () => {
  it("rejects a class_id that doesn't belong to the tenant", async () => {
    const { service, classRepo } = await buildService();
    classRepo.findOne = vi.fn(async () => null);

    await expect(
      service.create(
        {
          name: 'Term 1',
          kind: ExamKind.TERM,
          academic_year_id: 'y1',
          class_id: 'other-tenant-class',
        } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a class whose academic_year_id does not match the given year', async () => {
    const { service, classRepo } = await buildService();
    classRepo.findOne = vi.fn(async ({ where }: any) => ({
      id: where.id,
      tenant_id: where.tenant_id,
      academic_year_id: 'y-different',
    }));

    await expect(
      service.create(
        { name: 'Term 1', kind: ExamKind.TERM, academic_year_id: 'y1', class_id: 'c1' } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects an academic_year_id that doesn't belong to the tenant", async () => {
    const { service, yearRepo } = await buildService();
    yearRepo.findOne = vi.fn(async () => null);

    await expect(
      service.create(
        { name: 'Term 1', kind: ExamKind.TERM, academic_year_id: 'y1', class_id: 'c1' } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects an academic_term_id that doesn't belong to the tenant/year", async () => {
    const { service, termRepo } = await buildService();
    termRepo.findOne = vi.fn(async () => null);

    await expect(
      service.create(
        {
          name: 'Term 1',
          kind: ExamKind.TERM,
          academic_year_id: 'y1',
          class_id: 'c1',
          academic_term_id: 'other-tenant-term',
        } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('re-validates references on update when class_id/academic_year_id/academic_term_id is present', async () => {
    const { service, examRepo, classRepo } = await buildService();
    examRepo.findOne = vi.fn(async () => ({
      id: 'e1',
      tenant_id: TENANT_ID,
      class_id: 'c1',
      academic_year_id: 'y1',
    }));
    classRepo.findOne = vi.fn(async () => null);

    await expect(
      service.update('e1', { class_id: 'other-tenant-class' } as any, TENANT_ID),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('ExamsService duplicate-name mapping', () => {
  it('maps a unique-constraint violation on create to 409, not a raw 500', async () => {
    const { service, examRepo } = await buildService();
    examRepo.save = vi.fn(async () => {
      throw new QueryFailedError(
        'insert',
        [],
        Object.assign(new Error('duplicate'), { code: '23505' }),
      );
    });

    await expect(
      service.create(
        { name: 'Term 1', kind: ExamKind.TERM, academic_year_id: 'y1', class_id: 'c1' } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(ConflictException);
  });
});
