import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { RoutineState, SlotRecurrence } from '@biddaloy/shared';
import { SubstitutionsService } from './substitutions.service';
import { attentionEvents } from '../attention/attention.constants';
import { ATTENTION_RECHECK } from '../attention/engine/attention-events';

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
    delete: vi.fn(async () => undefined),
    create: vi.fn((v: any) => v),
    save: vi.fn(async (v: any) => ({ id: 'sub-1', ...v })),
    createQueryBuilder: vi.fn(() => qb),
  };
  // `remove()` runs in a transaction; its manager hands back the same mock.
  substitutionRepo.manager = {
    transaction: (cb: any) => cb({ getRepository: () => substitutionRepo }),
  };
  const qb: any = {
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    getMany: vi.fn(async () => []),
  };
  const slotRepo: any = { findOne: vi.fn(async () => SLOT), find: vi.fn(async () => []) };
  const routineRepo: any = { findOne: vi.fn(async () => ROUTINE) };
  const yearRepo: any = { findOne: vi.fn(async () => YEAR) };
  const teacherRepo: any = {
    findOne: vi.fn(async () => ({ id: 't-2', tenant_id: TENANT_ID, user_id: 'u-2' })),
  };
  const slotTeacherRepo: any = { find: vi.fn(async () => [{ teacher_id: 't-1' }]) };
  const sectionRepo: any = { find: vi.fn(async () => []) };
  const subjectRepo: any = { find: vi.fn(async () => []) };
  const periodSlotRepo: any = {
    find: vi.fn(async () => []),
    findOne: vi.fn(async () => ({
      shift_id: 'shift-1',
      sequence: 1,
      starts_at: '08:00:00',
      ends_at: '08:40:00',
    })),
  };
  const busy: any = { busyAt: vi.fn(async () => null) };
  const settings: any = { attendance: { specialTimings: [] } };
  const schools: any = { getResolvedSettings: vi.fn(async () => settings) };
  const audit: any = { record: vi.fn(async () => undefined) };
  const service = new SubstitutionsService(
    substitutionRepo,
    slotRepo,
    routineRepo,
    yearRepo,
    teacherRepo,
    slotTeacherRepo,
    periodSlotRepo,
    busy,
    schools,
    audit,
    sectionRepo,
    subjectRepo,
  );
  return {
    service,
    audit,
    sectionRepo,
    subjectRepo,
    periodSlotRepo,
    settings,
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

  it('list() returns the slot summary from any year, batch-loaded, with no year filter [2897]', async () => {
    // The slot belongs to an old year's routine: nothing here knows or cares which year is current.
    ctx.qb.getMany = vi.fn(async () => [
      { id: 'sub-1', routine_slot_id: 'slot-old' },
      { id: 'sub-2', routine_slot_id: 'slot-gone' },
    ]);
    ctx.slotRepo.find = vi.fn(async () => [
      { id: 'slot-old', section_id: 'sec-1', period_slot_id: 'p-1', subject_id: 'subj-1' },
    ]);
    ctx.periodSlotRepo.find = vi.fn(async () => [
      { id: 'p-1', sequence: 3, starts_at: '09:30:00' },
    ]);
    ctx.sectionRepo.find = vi.fn(async () => [
      { id: 'sec-1', section_name: 'B', class: { name: 'Class 5' } },
    ]);
    ctx.subjectRepo.find = vi.fn(async () => [{ id: 'subj-1', name_en: 'Math', name_bn: null }]);
    ctx.slotTeacherRepo.find = vi.fn(async () => [
      { routine_slot_id: 'slot-old', teacher_id: 't-1' },
    ]);

    const result = await ctx.service.list({} as any, TENANT_ID);

    expect(result[0]!.slot).toEqual({
      section_id: 'sec-1',
      class_name: 'Class 5',
      section_name: 'B',
      period_sequence: 3,
      starts_at: '09:30:00',
      subject_name_en: 'Math',
      subject_name_bn: null,
      teacher_ids: ['t-1'],
    });
    // A row whose slot is gone comes back with `slot: null`, not a crash.
    expect(result[1]!.slot).toBeNull();
    // Archived sections / subjects of an old year are still found.
    expect(ctx.sectionRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ withDeleted: true }),
    );
    expect(ctx.subjectRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ withDeleted: true }),
    );
  });

  describe('remove', () => {
    const ROW = {
      id: 'sub-1',
      routine_slot_id: 'slot-1',
      date: '2099-01-01', // future: still deletable
      substitute_teacher_id: 't-2',
      is_cancelled: false,
    };

    it('deletes the row, writes a DELETE audit and emits the rechecks', async () => {
      ctx.substitutionRepo.findOne = vi.fn(async () => ROW);
      const seen: string[] = [];
      const listener = (e: { ruleKey: string }) => seen.push(e.ruleKey);
      attentionEvents.on(ATTENTION_RECHECK, listener);
      await ctx.service.remove('sub-1', TENANT_ID, 'user-1');
      attentionEvents.off(ATTENTION_RECHECK, listener);
      expect(seen).toEqual(['routine.substitution_today', 'routine.changed_today']);
      expect(ctx.substitutionRepo.delete).toHaveBeenCalledWith({
        id: 'sub-1',
        tenant_id: TENANT_ID,
      });
      expect(ctx.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETE',
          entity_type: 'RoutineSubstitution',
          entity_id: 'sub-1',
          old_values: expect.objectContaining({ routine_slot_id: 'slot-1', date: '2099-01-01' }),
        }),
        expect.anything(), // the transaction manager: delete and audit commit together
      );
    });

    it('refuses (409) to delete a past-dated substitution and keeps the row', async () => {
      ctx.substitutionRepo.findOne = vi.fn(async () => ({ ...ROW, date: '2000-01-01' }));
      const err: any = await ctx.service.remove('sub-1', TENANT_ID, 'user-1').catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse().details.code).toBe('SUBSTITUTION_IN_PAST');
      expect(ctx.substitutionRepo.delete).not.toHaveBeenCalled();
    });

    it("another tenant's id is a 404 whose text carries no id", async () => {
      ctx.substitutionRepo.findOne = vi.fn(async () => null);
      const err: any = await ctx.service.remove('sub-9', TENANT_ID, 'user-1').catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.message).not.toContain('sub-9');
      expect(ctx.substitutionRepo.delete).not.toHaveBeenCalled();
    });
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

    // A special timing (e.g. Ramadan) moves P1 to 08:30-09:05 on that date: the clash check must
    // ask about the real dated window, or it accepts a cover that clashes with an exam at 08:45.
    it('checks the dated period window when a special timing covers the date', async () => {
      ctx.settings.attendance.specialTimings = [
        {
          name: 'Ramadan',
          from: '2026-01-01',
          to: '2026-01-31',
          shiftId: null,
          lateAfter: '08:45',
          absentAfter: '10:00',
          periods: [{ sequence: 1, startsAt: '08:30', endsAt: '09:05' }],
        },
      ];
      await ctx.service.record(dto as any, TENANT_ID, 'user-1');
      expect(ctx.busy.busyAt).toHaveBeenCalledWith(
        expect.objectContaining({ date: '2026-01-05', from: '08:30', to: '09:05' }),
      );
    });

    it('is_cancelled: true never calls busyAt', async () => {
      await ctx.service.record({ ...dto, is_cancelled: true } as any, TENANT_ID, 'user-1');
      expect(ctx.busy.busyAt).not.toHaveBeenCalled();
    });
  });
});
