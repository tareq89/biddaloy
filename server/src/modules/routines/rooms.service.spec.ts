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
    softDelete: vi.fn(async () => undefined),
  };
  const routineSlotRepo: any = { count: vi.fn(async () => 0) };
  const service = new RoomsService(repo, routineSlotRepo);
  return { service, repo, routineSlotRepo };
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

  it('refuses to delete a room referenced by a routine slot, naming the count', async () => {
    ctx.repo.findOne = vi.fn(async () => ({ id: 'room-1', tenant_id: TENANT_ID }));
    ctx.routineSlotRepo.count = vi.fn(async () => 2);
    await expect(ctx.service.remove('room-1', TENANT_ID)).rejects.toThrow(/2 routine slot\(s\)/);
    await expect(ctx.service.remove('room-1', TENANT_ID)).rejects.toThrow(ConflictException);
    expect(ctx.repo.softDelete).not.toHaveBeenCalled();
  });

  it('soft-deletes an unreferenced room', async () => {
    ctx.repo.findOne = vi.fn(async () => ({ id: 'room-1', tenant_id: TENANT_ID }));
    ctx.routineSlotRepo.count = vi.fn(async () => 0);
    await ctx.service.remove('room-1', TENANT_ID);
    expect(ctx.repo.softDelete).toHaveBeenCalledWith({ id: 'room-1', tenant_id: TENANT_ID });
  });
});
