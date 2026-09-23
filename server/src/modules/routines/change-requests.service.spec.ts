import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ChangeRequestState, RoutineState } from '@biddaloy/shared';
import { ChangeRequestsService } from './change-requests.service';

const TENANT_ID = 'tenant-1';
const CONTEXT = { ip: null, userAgent: null };

function buildService(
  overrides: { routineState?: RoutineState; requests?: any[]; slots?: any[] } = {},
) {
  const slot = { id: 'slot-1', tenant_id: TENANT_ID, routine_id: 'routine-1' };
  const routine = {
    id: 'routine-1',
    tenant_id: TENANT_ID,
    state: overrides.routineState ?? RoutineState.PUBLISHED,
    deleted_at: null,
  };
  const requests: any[] = overrides.requests ?? [];

  const slotRepo: any = {
    findOne: vi.fn(async () => (overrides.slots ? overrides.slots[0] : slot)),
    find: vi.fn(async () => overrides.slots ?? [slot]),
  };
  const routineRepo: any = { findOne: vi.fn(async () => routine) };
  const requestRepo: any = {
    create: vi.fn((v: any) => ({ id: `cr-${requests.length + 1}`, ...v })),
    save: vi.fn(async (v: any) => {
      const idx = requests.findIndex((r) => r.id === v.id);
      if (idx >= 0) requests[idx] = v;
      else requests.push(v);
      return v;
    }),
    findOne: vi.fn(async ({ where }: any) => requests.find((r) => r.id === where.id) ?? null),
    findOneOrFail: vi.fn(async ({ where }: any) => {
      const found = requests.find((r) => r.id === where.id);
      if (!found) throw new Error('not found');
      return found;
    }),
    update: vi.fn(async (where: any, patch: any) => {
      const found = requests.find((r) => r.id === where.id && r.state === where.state);
      if (!found) return { affected: 0 };
      Object.assign(found, patch);
      return { affected: 1 };
    }),
    createQueryBuilder: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn(async () => requests),
    })),
  };
  const auditService: any = { record: vi.fn(async () => undefined) };

  const service = new ChangeRequestsService(requestRepo, slotRepo, routineRepo, auditService);
  return { service, requestRepo, slotRepo, routineRepo, auditService, requests };
}

describe('ChangeRequestsService [21.6.1] D11', () => {
  it('opens a request against a published slot', async () => {
    const ctx = buildService();
    const result = await ctx.service.open(
      'slot-1',
      { note: 'please move this period' },
      TENANT_ID,
      'teacher-user-1',
    );
    expect(result.state).toBe(ChangeRequestState.OPEN);
    expect(result.requested_by).toBe('teacher-user-1');
  });

  it('refuses to open against a DRAFT/REVIEW routine', async () => {
    const ctx = buildService({ routineState: RoutineState.DRAFT });
    await expect(
      ctx.service.open('slot-1', { note: 'x' }, TENANT_ID, 'teacher-user-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('404s opening against a slot outside the tenant', async () => {
    const ctx = buildService({ slots: [] });
    ctx.slotRepo.findOne = vi.fn(async () => null);
    await expect(
      ctx.service.open('slot-1', { note: 'x' }, TENANT_ID, 'teacher-user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('any ROUTINE_MANAGE holder (not just the original manager) can accept', async () => {
    const existing = {
      id: 'cr-1',
      tenant_id: TENANT_ID,
      routine_slot_id: 'slot-1',
      requested_by: 'teacher-user-1',
      note: 'move it',
      state: ChangeRequestState.OPEN,
      resolved_by: null,
      resolved_at: null,
      resolution_note: null,
    };
    const ctx = buildService({ requests: [existing] });
    const result = await ctx.service.resolve(
      'cr-1',
      { state: ChangeRequestState.ACCEPTED, resolution_note: 'will reshuffle' },
      TENANT_ID,
      'a-different-manager',
      CONTEXT,
    );
    expect(result.state).toBe(ChangeRequestState.ACCEPTED);
    expect(result.resolved_by).toBe('a-different-manager');
    expect(result.resolution_note).toBe('will reshuffle');
  });

  it('can also reject', async () => {
    const existing = {
      id: 'cr-1',
      tenant_id: TENANT_ID,
      routine_slot_id: 'slot-1',
      requested_by: 'teacher-user-1',
      note: 'move it',
      state: ChangeRequestState.OPEN,
      resolved_by: null,
      resolved_at: null,
      resolution_note: null,
    };
    const ctx = buildService({ requests: [existing] });
    const result = await ctx.service.resolve(
      'cr-1',
      { state: ChangeRequestState.REJECTED },
      TENANT_ID,
      'manager-1',
      CONTEXT,
    );
    expect(result.state).toBe(ChangeRequestState.REJECTED);
  });

  it('refuses to re-resolve an already-resolved request', async () => {
    const existing = {
      id: 'cr-1',
      tenant_id: TENANT_ID,
      routine_slot_id: 'slot-1',
      requested_by: 'teacher-user-1',
      note: 'move it',
      state: ChangeRequestState.ACCEPTED,
      resolved_by: 'manager-1',
      resolved_at: new Date(),
      resolution_note: null,
    };
    const ctx = buildService({ requests: [existing] });
    await expect(
      ctx.service.resolve(
        'cr-1',
        { state: ChangeRequestState.REJECTED },
        TENANT_ID,
        'manager-2',
        CONTEXT,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('stays resolvable/listable regardless of the routine having since been published again', async () => {
    const existing = {
      id: 'cr-1',
      tenant_id: TENANT_ID,
      routine_slot_id: 'slot-1',
      requested_by: 'teacher-user-1',
      note: 'move it',
      state: ChangeRequestState.OPEN,
      resolved_by: null,
      resolved_at: null,
      resolution_note: null,
    };
    const ctx = buildService({ requests: [existing], routineState: RoutineState.PUBLISHED });
    const result = await ctx.service.resolve(
      'cr-1',
      { state: ChangeRequestState.ACCEPTED },
      TENANT_ID,
      'manager-1',
      CONTEXT,
    );
    expect(result.state).toBe(ChangeRequestState.ACCEPTED);
  });
});
