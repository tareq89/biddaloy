import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { RoutineState, SlotRecurrence } from '@biddaloy/shared';
import { SubstitutionsService } from './substitutions.service';

const TENANT_ID = 'tenant-1';
const YEAR = { id: 'year-1', start_date: '2026-01-04' };
const ROUTINE = { id: 'routine-1', tenant_id: TENANT_ID, academic_year_id: YEAR.id };
const SLOT = {
  id: 'slot-1',
  routine_id: ROUTINE.id,
  weekday: 1, // Monday
  recurrence: SlotRecurrence.WEEKLY,
  recurrence_offset: 0,
  valid_from: '2026-01-01',
  valid_to: null,
};

function buildService() {
  const substitutionRepo: any = {
    findOne: vi.fn(async () => null),
    update: vi.fn(async () => undefined),
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: 'sub-1', ...v })),
    createQueryBuilder: vi.fn(() => qb),
  };
  const qb: any = {
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    getMany: vi.fn(async () => []),
  };
  const slotRepo: any = { findOne: vi.fn(async () => SLOT) };
  const routineRepo: any = { findOne: vi.fn(async () => ROUTINE) };
  const yearRepo: any = { findOne: vi.fn(async () => YEAR) };
  const service = new SubstitutionsService(substitutionRepo, slotRepo, routineRepo, yearRepo);
  return { service, substitutionRepo, slotRepo, routineRepo, yearRepo, qb };
}

describe('SubstitutionsService [21.5.1]', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('throws NotFoundException for a slot outside the tenant', async () => {
    ctx.slotRepo.findOne = vi.fn(async () => null);
    await expect(
      ctx.service.record(
        { routine_slot_id: 'slot-1', date: '2026-01-05' } as any,
        TENANT_ID,
        'user-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('records a cover for an occurring date', async () => {
    const result = await ctx.service.record(
      { routine_slot_id: 'slot-1', date: '2026-01-05', substitute_teacher_id: 't-2' } as any,
      TENANT_ID,
      'user-1',
    );
    expect(result).toMatchObject({ substitute_teacher_id: 't-2' });
  });

  it('refuses a substitution on a date the slot does not occur on', async () => {
    await expect(
      ctx.service.record(
        { routine_slot_id: 'slot-1', date: '2026-01-06' } as any, // Tuesday, slot is Monday
        TENANT_ID,
        'user-1',
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('never touches routine_slots — only the substitution repo is written to', async () => {
    await ctx.service.record(
      { routine_slot_id: 'slot-1', date: '2026-01-05', is_cancelled: true } as any,
      TENANT_ID,
      'user-1',
    );
    expect(ctx.slotRepo.findOne).toHaveBeenCalled();
    expect((ctx.slotRepo as any).update).toBeUndefined();
    expect(ctx.substitutionRepo.save).toHaveBeenCalled();
  });

  it('list scopes the query to the caller tenant', async () => {
    await ctx.service.list({}, TENANT_ID);
    expect(ctx.qb.where).toHaveBeenCalledWith('sub.tenant_id = :tenantId', { tenantId: TENANT_ID });
  });
});
