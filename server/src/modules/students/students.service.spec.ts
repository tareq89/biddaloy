import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PayloadTooLargeException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StudentService } from './students.service';
import { Student } from './entities/student.entity';
import { Guardian } from './entities/guardian.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Class } from '../academics/entities/class.entity';

/**
 * Unit tests for `StudentService.findAllIds` [16.3.3] — the audience
 * picker's "select all matching" endpoint. The 5,000-row cap can't
 * practically be exercised against a real database (seeding that many rows
 * per test run is slow and adds nothing `students.service.integration.spec.ts`
 * doesn't already cover for filter correctness), so the repository is
 * mocked here to assert the cap boundary itself.
 */

/** A chainable QueryBuilder stub exposing only what `buildStudentIdsQuery` uses. */
function createQueryBuilderStub(result: { raw?: unknown[]; count?: number }) {
  const qb: any = {
    select: vi.fn(() => qb),
    leftJoin: vi.fn(() => qb),
    where: vi.fn(() => qb),
    andWhere: vi.fn(() => qb),
    orderBy: vi.fn(() => qb),
    addOrderBy: vi.fn(() => qb),
    offset: vi.fn(() => qb),
    limit: vi.fn(() => qb),
    getCount: vi.fn(async () => result.count ?? 0),
    getRawMany: vi.fn(async () => result.raw ?? []),
  };
  return qb;
}

const TENANT_ID = 'tenant-1';

describe('StudentService.findAllIds', () => {
  let service: StudentService;
  let repo: { createQueryBuilder: ReturnType<typeof vi.fn> };
  let qb: ReturnType<typeof createQueryBuilderStub>;

  async function build(result: Parameters<typeof createQueryBuilderStub>[0] = {}) {
    qb = createQueryBuilderStub(result);
    repo = { createQueryBuilder: vi.fn(() => qb) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudentService,
        { provide: getRepositoryToken(Student), useValue: repo },
        { provide: getRepositoryToken(Guardian), useValue: {} },
        { provide: getRepositoryToken(ClassSection), useValue: {} },
        { provide: getRepositoryToken(Class), useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(StudentService);
  }

  it('returns the matching ids and total when under the cap', async () => {
    await build({ count: 2, raw: [{ id: 'a' }, { id: 'b' }] });

    const result = await service.findAllIds({}, TENANT_ID);

    expect(result).toEqual({ ids: ['a', 'b'], total: 2 });
  });

  it('throws 413 when the match count exceeds the 5,000 cap, without fetching rows', async () => {
    await build({ count: 5001 });

    await expect(service.findAllIds({}, TENANT_ID)).rejects.toThrow(PayloadTooLargeException);
    expect(qb.getRawMany).not.toHaveBeenCalled();
  });

  it('allows exactly 5,000 matches (the cap is inclusive)', async () => {
    await build({ count: 5000, raw: Array.from({ length: 5000 }, (_, i) => ({ id: `s${i}` })) });

    const result = await service.findAllIds({}, TENANT_ID);

    expect(result.total).toBe(5000);
    expect(result.ids).toHaveLength(5000);
  });
});
