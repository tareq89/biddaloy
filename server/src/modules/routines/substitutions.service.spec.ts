import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
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
  const teacherRepo: any = {
    findOne: vi.fn(async () => ({ id: 't-2', tenant_id: TENANT_ID, user_id: 'u-2' })),
  };
  const slotTeacherRepo: any = { find: vi.fn(async () => [{ teacher_id: 't-1' }]) };
  const periodSlotRepo: any = {
    findOne: vi.fn(async () => ({ starts_at: '08:00:00', ends_at: '08:40:00' })),
  };
  const busy: any = { busyAt: vi.fn(async () => null) };
  const service = new SubstitutionsService(
    substitutionRepo,
    slotRepo,
    routineRepo,
    yearRepo,
    teacherRepo,
    slotTeacherRepo,
    periodSlotRepo,
    busy,
  );
  return {
    service,
    slotTeacherRepo,
    busy,
    substitutionRepo,
    slotRepo,
    routineRepo,
    yearRepo,
    teacherRepo,
    qb,
  };
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

  it('refuses a substitution on a date the slot does not occur on, with code SLOT_NOT_ON_DATE', async () => {
    const attempt = ctx.service.record(
      { routine_slot_id: 'slot-1', date: '2026-01-06' } as any, // Tuesday, slot is Monday
      TENANT_ID,
      'user-1',
    );
    await expect(attempt).rejects.toThrow(UnprocessableEntityException);
    await expect(attempt).rejects.toMatchObject({
      response: { details: { code: 'SLOT_NOT_ON_DATE' } },
    });
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

  describe('availability [TEN-07]', () => {
    const dto = { routine_slot_id: 'slot-1', date: '2026-01-05', substitute_teacher_id: 't-2' };

    it("substitute equal to the slot's own teacher -> 409 SUBSTITUTE_IS_SLOT_TEACHER", async () => {
      ctx.slotTeacherRepo.find = vi.fn(async () => [{ teacher_id: 't-2' }]);
      const err: any = await ctx.service.record(dto as any, TENANT_ID, 'user-1').catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse().details.code).toBe('SUBSTITUTE_IS_SLOT_TEACHER');
      expect(ctx.substitutionRepo.save).not.toHaveBeenCalled();
    });

    it('busyAt returns a clash -> 409 TEACHER_BUSY and nothing is saved', async () => {
      ctx.busy.busyAt = vi.fn(async () => ({
        kind: 'TEACHING',
        tenantId: 't',
        tenantName: 'High School',
        from: '08:00',
        to: '08:40',
      }));
      const err: any = await ctx.service.record(dto as any, TENANT_ID, 'user-1').catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse().details).toEqual({
        code: 'TEACHER_BUSY',
        kind: 'TEACHING',
        tenantName: 'High School',
        from: '08:00',
        to: '08:40',
      });
      expect(ctx.busy.busyAt).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          userId: 'u-2',
          date: '2026-01-05',
          from: '08:00',
          to: '08:40',
          actorUserId: 'user-1',
          exclude: { routineSlotId: 'slot-1' },
        }),
      );
      expect(ctx.substitutionRepo.save).not.toHaveBeenCalled();
    });

    it('is_cancelled: true never calls busyAt', async () => {
      await ctx.service.record({ ...dto, is_cancelled: true } as any, TENANT_ID, 'user-1');
      expect(ctx.busy.busyAt).not.toHaveBeenCalled();
    });
  });
});
