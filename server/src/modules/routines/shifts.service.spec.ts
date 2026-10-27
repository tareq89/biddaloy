import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { ShiftsService } from './shifts.service';

const TENANT_ID = 'tenant-1';
const OTHER_TENANT_ID = 'tenant-2';

function buildService() {
  const repo: any = {
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: 'shift-1', ...v })),
    findOne: vi.fn(async () => null),
    findAndCount: vi.fn(async () => [[], 0]),
    update: vi.fn(async () => undefined),
    softDelete: vi.fn(async () => undefined),
  };
  const periodSlotRepo: any = { count: vi.fn(async () => 0), find: vi.fn(async () => []) };
  // `remove()` runs inside `this.repo.manager.transaction(...)` — the
  // transaction manager's repos delegate to the same mocks above so
  // existing `expect(ctx.repo...)` / `expect(ctx.periodSlotRepo...)`
  // assertions still see the calls.
  repo.manager = {
    transaction: (cb: any) =>
      cb({
        getRepository: (entity: any) => (entity?.name === 'PeriodSlot' ? periodSlotRepo : repo),
      }),
  };
  const service = new ShiftsService(repo, periodSlotRepo);
  return { service, repo, periodSlotRepo };
}

describe('ShiftsService [21.3.1]', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('creates a shift scoped to the tenant', async () => {
    const dto = { name: 'Morning', day_starts_at: '08:00', day_ends_at: '13:00', sequence: 1 };
    await ctx.service.create(dto as any, TENANT_ID);
    expect(ctx.repo.save).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: TENANT_ID }));
  });

  it('findOne throws NotFoundException when the shift is missing', async () => {
    await expect(ctx.service.findOne('missing', TENANT_ID)).rejects.toThrow(NotFoundException);
  });

  it("findOne does not return another tenant's shift", async () => {
    // A tenant-scoped `where` clause means the repo itself never returns
    // cross-tenant rows — this asserts the query was scoped, not the DB.
    ctx.repo.findOne = vi.fn(async (opts: any) => {
      expect(opts.where.tenant_id).toBe(TENANT_ID);
      return null;
    });
    await expect(ctx.service.findOne('shift-1', TENANT_ID)).rejects.toThrow(NotFoundException);
  });

  it('update only writes provided keys, scoped to the tenant', async () => {
    ctx.repo.findOne = vi.fn(async () => ({
      id: 'shift-1',
      tenant_id: TENANT_ID,
      name: 'Morning',
    }));
    await ctx.service.update('shift-1', { name: 'Day' } as any, TENANT_ID);
    expect(ctx.repo.update).toHaveBeenCalledWith(
      { id: 'shift-1', tenant_id: TENANT_ID },
      { name: 'Day' },
    );
  });

  it('refuses a day window that shrinks past a period', async () => {
    ctx.repo.findOne = vi.fn(async () => ({
      id: 'shift-1',
      tenant_id: TENANT_ID,
      day_starts_at: '08:00:00',
      day_ends_at: '14:00:00',
    }));
    ctx.periodSlotRepo.find = vi.fn(async () => [{ starts_at: '12:00:00', ends_at: '13:00:00' }]);
    const err: any = await ctx.service
      .update('shift-1', { day_ends_at: '12:30' } as any, TENANT_ID)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().details.code).toBe('SHIFT_PERIODS_OUTSIDE_WINDOW');
    expect(ctx.repo.update).not.toHaveBeenCalled();
  });

  it('refuses a day that ends before it starts', async () => {
    ctx.repo.findOne = vi.fn(async () => ({
      id: 'shift-1',
      tenant_id: TENANT_ID,
      day_starts_at: '08:00:00',
      day_ends_at: '14:00:00',
    }));
    await expect(
      ctx.service.update('shift-1', { day_starts_at: '15:00' } as any, TENANT_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows a day window that still holds every period', async () => {
    ctx.repo.findOne = vi.fn(async () => ({
      id: 'shift-1',
      tenant_id: TENANT_ID,
      day_starts_at: '08:00:00',
      day_ends_at: '14:00:00',
    }));
    ctx.periodSlotRepo.find = vi.fn(async () => [{ starts_at: '09:00:00', ends_at: '10:00:00' }]);
    await ctx.service.update('shift-1', { day_ends_at: '12:00' } as any, TENANT_ID);
    expect(ctx.repo.update).toHaveBeenCalled();
  });

  it('refuses to delete a shift with period slots, naming the count', async () => {
    ctx.repo.findOne = vi.fn(async () => ({ id: 'shift-1', tenant_id: TENANT_ID }));
    ctx.periodSlotRepo.count = vi.fn(async () => 3);
    await expect(ctx.service.remove('shift-1', TENANT_ID)).rejects.toThrow(/3 period slot\(s\)/);
    await expect(ctx.service.remove('shift-1', TENANT_ID)).rejects.toThrow(ConflictException);
    expect(ctx.repo.softDelete).not.toHaveBeenCalled();
  });

  it('soft-deletes a shift with no period slots', async () => {
    ctx.repo.findOne = vi.fn(async () => ({ id: 'shift-1', tenant_id: TENANT_ID }));
    ctx.periodSlotRepo.count = vi.fn(async () => 0);
    await ctx.service.remove('shift-1', TENANT_ID);
    expect(ctx.repo.softDelete).toHaveBeenCalledWith({ id: 'shift-1', tenant_id: TENANT_ID });
  });

  it('remove is scoped so cross-tenant deletes cannot happen', async () => {
    ctx.repo.findOne = vi.fn(async (opts: any) =>
      opts.where.tenant_id === OTHER_TENANT_ID ? { id: 'shift-1' } : null,
    );
    await expect(ctx.service.remove('shift-1', TENANT_ID)).rejects.toThrow(NotFoundException);
  });
});
