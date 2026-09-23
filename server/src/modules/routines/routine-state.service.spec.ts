import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RoutineState } from '@biddaloy/shared';
import { RoutineStateService } from './routine-state.service';

const TENANT_ID = 'tenant-1';
const CONTEXT = { ip: null, userAgent: null };

function buildService(state: RoutineState = RoutineState.DRAFT) {
  const routine: any = {
    id: 'routine-1',
    tenant_id: TENANT_ID,
    state,
    published_at: null,
    deleted_at: null,
  };
  const routineRepo: any = {
    findOne: vi.fn(async () => routine),
    findOneOrFail: vi.fn(async () => routine),
    update: vi.fn(async (_where: any, patch: any) => {
      Object.assign(routine, patch);
      return { affected: 1 };
    }),
  };
  const auditService: any = { record: vi.fn(async () => undefined) };
  const service = new RoutineStateService(routineRepo, auditService);
  return { service, routineRepo, auditService, routine };
}

describe('RoutineStateService [21.6.1] D11 state machine', () => {
  it('DRAFT -> REVIEW is legal', async () => {
    const ctx = buildService(RoutineState.DRAFT);
    const result = await ctx.service.submitForReview('routine-1', TENANT_ID, 'user-1', CONTEXT);
    expect(result.state).toBe(RoutineState.REVIEW);
    expect(ctx.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entity_type: 'Routine',
        old_values: { state: RoutineState.DRAFT },
        new_values: expect.objectContaining({ state: RoutineState.REVIEW }),
      }),
    );
  });

  it('REVIEW -> DRAFT (withdraw) is legal', async () => {
    const ctx = buildService(RoutineState.REVIEW);
    const result = await ctx.service.withdraw('routine-1', TENANT_ID, 'user-1', CONTEXT);
    expect(result.state).toBe(RoutineState.DRAFT);
  });

  it('REVIEW -> PUBLISHED is legal and stamps published_at', async () => {
    const ctx = buildService(RoutineState.REVIEW);
    const result = await ctx.service.publish('routine-1', TENANT_ID, 'user-1', CONTEXT);
    expect(result.state).toBe(RoutineState.PUBLISHED);
    expect(result.published_at).toBeInstanceOf(Date);
  });

  it('DRAFT -> PUBLISHED is refused (must go through REVIEW)', async () => {
    const ctx = buildService(RoutineState.DRAFT);
    await expect(ctx.service.publish('routine-1', TENANT_ID, 'user-1', CONTEXT)).rejects.toThrow(
      ConflictException,
    );
  });

  it('PUBLISHED refuses every transition — submit-for-review', async () => {
    const ctx = buildService(RoutineState.PUBLISHED);
    await expect(
      ctx.service.submitForReview('routine-1', TENANT_ID, 'user-1', CONTEXT),
    ).rejects.toThrow(ConflictException);
  });

  it('PUBLISHED refuses every transition — withdraw', async () => {
    const ctx = buildService(RoutineState.PUBLISHED);
    await expect(ctx.service.withdraw('routine-1', TENANT_ID, 'user-1', CONTEXT)).rejects.toThrow(
      ConflictException,
    );
  });

  it('PUBLISHED refuses every transition — publish again', async () => {
    const ctx = buildService(RoutineState.PUBLISHED);
    await expect(ctx.service.publish('routine-1', TENANT_ID, 'user-1', CONTEXT)).rejects.toThrow(
      ConflictException,
    );
  });

  it('404s for a routine outside the caller tenant', async () => {
    const ctx = buildService(RoutineState.DRAFT);
    ctx.routineRepo.findOne = vi.fn(async () => null);
    await expect(
      ctx.service.submitForReview('routine-1', 'other-tenant', 'user-1', CONTEXT),
    ).rejects.toThrow(NotFoundException);
  });
});
