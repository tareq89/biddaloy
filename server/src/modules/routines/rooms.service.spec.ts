import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { RoomsService } from './rooms.service';

const TENANT_ID = 'tenant-1';

function buildService() {
  const repo: any = {
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: 'room-1', ...v })),
    findOne: vi.fn(async () => null),
    findAndCount: vi.fn(async () => [[], 0]),
    update: vi.fn(async () => undefined),
    manager: {
      createQueryBuilder: vi.fn(),
      connection: { entityMetadatas: [] },
      count: vi.fn(async () => 0),
      softDelete: vi.fn(async () => undefined),
    },
  };
  // [2703 m4] The guard and the soft-delete share one transaction.
  repo.manager.transaction = vi.fn(async (cb: (m: unknown) => unknown) => cb(repo.manager));
  // [2706] `remove()` lock-reads the parent (`getOne`) and counts seat allocations
  // (`getCount`) through the same query-builder mock; tests override the resolved values.
  const locked = { value: { id: 'room-1', tenant_id: TENANT_ID } as unknown };
  const seatCount = { value: 0 };
  const qb: any = {
    setLock: vi.fn(() => qb),
    innerJoin: vi.fn(() => qb),
    where: vi.fn(() => qb),
    getOne: vi.fn(async () => locked.value),
    getCount: vi.fn(async () => seatCount.value),
  };
  repo.manager.createQueryBuilder = vi.fn(() => qb);
  const service = new RoomsService(repo);
  return { service, repo, qb, locked, seatCount };
}

describe('RoomsService [21.3.1]', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('creates a room scoped to the tenant, defaulting nullable fields', async () => {
    await ctx.service.create({ room_no: '204' } as any, TENANT_ID);
    expect(ctx.repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: TENANT_ID, building: null, capacity: null }),
    );
  });

  it('findOne throws NotFoundException when the room is missing', async () => {
    await expect(ctx.service.findOne('missing', TENANT_ID)).rejects.toThrow(NotFoundException);
  });

  it('rejects a request scoped to a tenant the room does not belong to', async () => {
    ctx.repo.findOne = vi.fn(async (opts: any) => {
      expect(opts.where.tenant_id).toBe(TENANT_ID);
      return null;
    });
    await expect(ctx.service.findOne('room-1', TENANT_ID)).rejects.toThrow(NotFoundException);
  });

  it('[2706] remove() 404s when the lock read finds no row for this tenant', async () => {
    ctx.locked.value = null;
    await expect(ctx.service.remove('room-1', TENANT_ID)).rejects.toThrow(NotFoundException);
    expect(ctx.qb.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(ctx.repo.manager.count).not.toHaveBeenCalled();
    expect(ctx.repo.manager.softDelete).not.toHaveBeenCalled();
  });

  it('refuses to delete a room referenced by a routine slot, naming the count', async () => {
    ctx.repo.manager.count = vi.fn(async () => 2);
    await expect(ctx.service.remove('room-1', TENANT_ID)).rejects.toThrow(/2 routine slot\(s\)/);
    await expect(ctx.service.remove('room-1', TENANT_ID)).rejects.toThrow(ConflictException);
    expect(ctx.repo.manager.softDelete).not.toHaveBeenCalled();
  });

  it('soft-deletes an unreferenced room', async () => {
    ctx.repo.manager.count = vi.fn(async () => 0);
    await ctx.service.remove('room-1', TENANT_ID);
    expect(ctx.repo.manager.softDelete).toHaveBeenCalledWith(expect.anything(), {
      id: 'room-1',
      tenant_id: TENANT_ID,
    });
  });

  it('[2627] refuses to delete a room used by a seat plan allocation', async () => {
    ctx.seatCount.value = 3;
    await expect(ctx.service.remove('room-1', TENANT_ID)).rejects.toThrow(ConflictException);
    expect(ctx.repo.manager.softDelete).not.toHaveBeenCalled();
  });
});
