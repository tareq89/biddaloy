import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RoutineState } from '@biddaloy/shared';
import { RoutineService } from './routine.service';

const TENANT_ID = 'tenant-1';

function buildService(
  academicYear: any = { id: 'year-1', tenant_id: TENANT_ID, deleted_at: null },
) {
  const repo: any = {
    findOne: vi.fn(async () => null),
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: 'routine-1', ...v })),
    find: vi.fn(async () => []),
  };
  const academicYearRepo: any = { findOne: vi.fn(async () => academicYear) };
  const service = new RoutineService(repo, academicYearRepo);
  return { service, repo, academicYearRepo };
}

describe('RoutineService [21.6.1]', () => {
  it('creates a routine once the academic year is found in this tenant', async () => {
    const ctx = buildService();
    const result = await ctx.service.create(
      { academic_year_id: 'year-1', name: 'Term 1' } as any,
      TENANT_ID,
    );
    expect(result.state).toBe(RoutineState.DRAFT);
    expect(ctx.academicYearRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'year-1', tenant_id: TENANT_ID }),
      }),
    );
  });

  it('404s when the academic year does not resolve in this tenant (cross-tenant id IDOR guard)', async () => {
    const ctx = buildService(null);
    await expect(
      ctx.service.create(
        { academic_year_id: 'other-tenant-year', name: 'Term 1' } as any,
        TENANT_ID,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(ctx.repo.save).not.toHaveBeenCalled();
  });

  it('refuses a second routine for the same academic year', async () => {
    const ctx = buildService();
    ctx.repo.findOne = vi.fn(async () => ({ id: 'existing' }));
    await expect(
      ctx.service.create({ academic_year_id: 'year-1', name: 'Term 1' } as any, TENANT_ID),
    ).rejects.toThrow(ConflictException);
  });
});
