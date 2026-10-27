import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  EnrollmentStatus,
  PeriodSlotKind,
  RoutineState,
  SlotRecurrence,
  UserRole,
} from '@biddaloy/shared';
import { RoutineSlotsService } from './routine-slots.service';
import { Routine } from './entities/routine.entity';
import { RoutineSlot } from './entities/routine-slot.entity';
import { RoutineSlotTeacher } from './entities/routine-slot-teacher.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { Room } from './entities/room.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { RoutineSubstitution } from './entities/routine-substitution.entity';

const TENANT_ID = 'tenant-1';
const ROUTINE_ID = 'routine-1';

function buildService() {
  const routine = { id: ROUTINE_ID, tenant_id: TENANT_ID, deleted_at: null };
  const periodSlot = {
    id: 'period-1',
    tenant_id: TENANT_ID,
    kind: PeriodSlotKind.CLASS,
    sequence: 0,
  };

  const routineRepo: any = { findOne: vi.fn(async () => routine) };
  const slots: any[] = [];
  const slotTeachers: any[] = [];

  const slotRepo: any = {
    find: vi.fn(async () => slots),
    findOne: vi.fn(async ({ where }: any) => slots.find((s) => s.id === where.id) ?? null),
    create: vi.fn((v: any) => ({ id: `slot-${slots.length + 1}`, ...v })),
    save: vi.fn(async (v: any) => {
      slots.push(v);
      return v;
    }),
    update: vi.fn(async ({ id }: any, patch: any) => {
      const s = slots.find((x) => x.id === id);
      if (s) Object.assign(s, patch);
    }),
    delete: vi.fn(async () => undefined),
  };
  const slotTeacherRepo: any = {
    // Real `In(slotIds)` filtering isn't worth reimplementing here — this
    // suite never has more than one routine's rows in play, so returning
    // everything already scoped to this tenant/routine is equivalent.
    find: vi.fn(async () => slotTeachers),
    create: vi.fn((v: any) => v),
    save: vi.fn(async (rows: any[]) => {
      slotTeachers.push(...rows);
      return rows;
    }),
    delete: vi.fn(async () => undefined),
  };
  const periodSlotRepo: any = {
    find: vi.fn(async () => [periodSlot]),
    findOne: vi.fn(async () => periodSlot),
  };
  const tcsRepo: any = { find: vi.fn(async () => []) };
  const settingsReader: any = { routineSettings: vi.fn(async () => ({})) };

  // Every foreign id in `baseDto` resolves in this tenant by default.
  const sectionRepo: any = {
    findOne: vi.fn(async () => ({ id: 'section-1', tenant_id: TENANT_ID })),
  };
  const subjectRepo: any = {
    findOne: vi.fn(async () => ({ id: 'subject-1', tenant_id: TENANT_ID })),
  };
  const roomRepo: any = { findOne: vi.fn(async () => null) };
  const teacherRepo: any = {
    findOne: vi.fn(async () => ({ id: 'teacher-1', tenant_id: TENANT_ID })),
    find: vi.fn(async () => [{ id: 'teacher-1', tenant_id: TENANT_ID }]),
  };

  const enrollmentRepo: any = { find: vi.fn(async () => []) };

  const reposByEntity = new Map<unknown, any>([
    [RoutineSlot, slotRepo],
    [Routine, routineRepo],
    [RoutineSlotTeacher, slotTeacherRepo],
    [PeriodSlot, periodSlotRepo],
    [ClassSection, sectionRepo],
    [Subject, subjectRepo],
    [Room, roomRepo],
    [Teacher, teacherRepo],
  ]);
  // #3022: how many substitutions / open change requests reference the slot.
  const refs = { substitutions: 0, openRequests: 0 };
  const manager: any = {
    count: vi.fn(async (entity: unknown) =>
      entity === RoutineSubstitution ? refs.substitutions : refs.openRequests,
    ),
    query: vi.fn(async () => []), // [58.0.03] cross-branch lookup: no other branch
    getRepository: (entity: unknown) => reposByEntity.get(entity),
    findOne: (entity: unknown, opts: any) => reposByEntity.get(entity).findOne(opts),
    findOneOrFail: (entity: unknown, opts: any) => reposByEntity.get(entity).findOne(opts),
    find: (entity: unknown, opts: any) => reposByEntity.get(entity).find(opts),
    update: (entity: unknown, where: any, patch: any) =>
      reposByEntity.get(entity).update(where, patch),
    delete: (entity: unknown, where: any) => reposByEntity.get(entity).delete(where),
  };
  const schoolsService: any = { getResolvedSettings: vi.fn(async () => ({})) };
  const auditService: any = { record: vi.fn(async () => undefined) };
  const dataSource: any = { transaction: (cb: any) => cb(manager) };

  const service = new RoutineSlotsService(
    routineRepo,
    slotRepo,
    slotTeacherRepo,
    periodSlotRepo,
    tcsRepo,
    settingsReader,
    dataSource,
    schoolsService,
    auditService,
    teacherRepo,
    enrollmentRepo,
  );
  return {
    schoolsService,
    auditService,
    service,
    routineRepo,
    slotRepo,
    slotTeacherRepo,
    periodSlotRepo,
    tcsRepo,
    settingsReader,
    sectionRepo,
    subjectRepo,
    roomRepo,
    teacherRepo,
    enrollmentRepo,
    refs,
    slots,
  };
}

const baseDto = {
  section_id: 'section-1',
  period_slot_id: 'period-1',
  weekday: 1,
  subject_id: 'subject-1',
  room_id: null,
  recurrence: SlotRecurrence.WEEKLY,
  recurrence_offset: 0,
  valid_from: '2026-01-01',
  valid_to: null,
  teacher_ids: ['teacher-1'],
};

describe('RoutineSlotsService [21.4.1]', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('create() throws NotFoundException for a routine outside the tenant', async () => {
    ctx.routineRepo.findOne = vi.fn(async () => null);
    await expect(ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('create() saves a slot with no clashes and returns no violations', async () => {
    const result = await ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID);
    expect(result.slot.section_id).toBe('section-1');
    expect(ctx.slotTeacherRepo.save).toHaveBeenCalled();
  });

  it('create() refuses a hard-constraint violation (BREAK slot) without writing', async () => {
    ctx.periodSlotRepo.findOne = vi.fn(async () => ({
      id: 'period-1',
      tenant_id: TENANT_ID,
      kind: PeriodSlotKind.BREAK,
      sequence: 0,
    }));
    await expect(ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID)).rejects.toThrow(
      ConflictException,
    );
    expect(ctx.slotRepo.save).not.toHaveBeenCalled();
  });

  it('create() nests violations under `details` so the client can render them', async () => {
    ctx.periodSlotRepo.findOne = vi.fn(async () => ({
      id: 'period-1',
      tenant_id: TENANT_ID,
      kind: PeriodSlotKind.BREAK,
      sequence: 0,
    }));
    await expect(ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID)).rejects.toMatchObject({
      response: { details: { violations: expect.any(Array) } },
    });
  });

  it('update() nests violations under `details` so the client can render them', async () => {
    const created = await ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID);
    ctx.periodSlotRepo.findOne = vi.fn(async () => ({
      id: 'period-1',
      tenant_id: TENANT_ID,
      kind: PeriodSlotKind.BREAK,
      sequence: 0,
    }));
    await expect(
      ctx.service.update(
        created.slot.id,
        { ...baseDto, valid_from: '2026-06-01' } as any,
        TENANT_ID,
        'user-1',
      ),
    ).rejects.toMatchObject({
      response: { details: { violations: expect.any(Array) } },
    });
  });

  it('remove() throws NotFoundException for a slot outside the tenant', async () => {
    await expect(ctx.service.remove('missing-slot', TENANT_ID, 'user-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('remove() on a DRAFT routine still hard-deletes and audits DELETE', async () => {
    const created = await ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID);
    await ctx.service.remove(created.slot.id, TENANT_ID, 'user-1');
    expect(ctx.slotRepo.delete).toHaveBeenCalledWith({ id: created.slot.id, tenant_id: TENANT_ID });
    expect(ctx.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entity_type: 'RoutineSlot', action: 'DELETE' }),
      expect.anything(),
    );
  });

  it('update() closes the old row (D4) rather than mutating it in place', async () => {
    const created = await ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID);
    const oldId = created.slot.id;

    await ctx.service.update(
      oldId,
      { ...baseDto, valid_from: '2026-06-01', subject_id: 'subject-2' } as any,
      TENANT_ID,
      'user-1',
    );

    // The old row is closed the day before the new one starts, never
    // deleted or mutated to the new subject.
    const oldRow = ctx.slots.find((s: any) => s.id === oldId);
    expect(oldRow.valid_to).toBe('2026-05-31');
    expect(oldRow.subject_id).toBe('subject-1');

    // A new row exists carrying the new fields.
    const newRow = ctx.slots.find((s: any) => s.id !== oldId);
    expect(newRow).toBeDefined();
    expect(newRow.subject_id).toBe('subject-2');
    expect(newRow.valid_from).toBe('2026-06-01');
  });

  it('update() with a valid_from at or before the old row replaces it in place', async () => {
    const created = await ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID);
    const result = await ctx.service.update(
      created.slot.id,
      { ...baseDto, subject_id: 'subject-2' } as any,
      TENANT_ID,
      'user-1',
    );
    // Same id, one row only, new subject, valid_to unchanged.
    expect(result.slot.id).toBe(created.slot.id);
    expect(ctx.slots).toHaveLength(1);
    expect(ctx.slots[0].subject_id).toBe('subject-2');
    expect(ctx.slots[0].valid_to).toBe(created.slot.valid_to);
  });

  it('update() in place is refused (409) when a substitution references the slot', async () => {
    const created = await ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID);
    ctx.refs.substitutions = 1;
    const err: any = await ctx.service
      .update(created.slot.id, { ...baseDto, subject_id: 'subject-2' } as any, TENANT_ID, 'u')
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().details.code).toBe('SLOT_HAS_SUBSTITUTIONS_OR_REQUESTS');
    expect(ctx.slots[0].subject_id).toBe(baseDto.subject_id);
  });

  it('update() in place is refused (409) when an open change request references the slot', async () => {
    const created = await ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID);
    ctx.refs.openRequests = 1;
    await expect(
      ctx.service.update(
        created.slot.id,
        { ...baseDto, subject_id: 'subject-2' } as any,
        TENANT_ID,
        'u',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('update() with a later valid_from still splits the row when substitutions exist', async () => {
    const created = await ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID);
    ctx.refs.substitutions = 2;
    await ctx.service.update(
      created.slot.id,
      { ...baseDto, valid_from: '2026-06-01' } as any,
      TENANT_ID,
      'u',
    );
    expect(ctx.slots).toHaveLength(2);
  });

  it('update() in place never reopens a row an earlier edit already closed', async () => {
    const created = await ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID);
    const oldId = created.slot.id;
    // Split: the old row is closed on 2026-05-31, a successor starts 2026-06-01.
    await ctx.service.update(
      oldId,
      { ...baseDto, valid_from: '2026-06-01' } as any,
      TENANT_ID,
      'u',
    );
    // Re-edit the closed row in place, moved to another weekday (no clash with
    // the successor), with no valid_to in the dto.
    await ctx.service.update(oldId, { ...baseDto, weekday: 2 } as any, TENANT_ID, 'u');
    const oldRow = ctx.slots.find((s: any) => s.id === oldId);
    expect(oldRow.weekday).toBe(2);
    expect(oldRow.valid_to).toBe('2026-05-31');
  });

  it('update() rejects re-editing a row that was already superseded by a later edit', async () => {
    const created = await ctx.service.create(ROUTINE_ID, baseDto as any, TENANT_ID);
    // First edit closes the original row at 2026-05-31 and opens a new one.
    await ctx.service.update(
      created.slot.id,
      { ...baseDto, valid_from: '2026-06-01' } as any,
      TENANT_ID,
      'user-1',
    );
    // Editing the now-superseded original row again, with a valid_from
    // that falls after its valid_to, must be rejected rather than
    // silently reopening/overwriting the closed row.
    await expect(
      ctx.service.update(
        created.slot.id,
        { ...baseDto, valid_from: '2026-09-01' } as any,
        TENANT_ID,
        'user-1',
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('RoutineSlotsService.findForRoutine visibility [86.1]', () => {
  const seed = (ctx: ReturnType<typeof buildService>, state: RoutineState) => {
    ctx.routineRepo.findOne = vi.fn(async () => ({
      id: ROUTINE_ID,
      tenant_id: TENANT_ID,
      state,
      academic_year_id: 'ay-1',
    }));
    ctx.slots.push({ id: 's1', section_id: 'sec-A' }, { id: 's2', section_id: 'sec-B' });
    ctx.slotTeacherRepo.find = vi.fn(async () => [
      { routine_slot_id: 's1', teacher_id: 'teacher-1' },
      { routine_slot_id: 's2', teacher_id: 'teacher-2' },
    ]);
  };
  const as = (role: UserRole) => ({ role, userId: 'u1' });

  it('DRAFT + TEACHER returns []', async () => {
    const ctx = buildService();
    seed(ctx, RoutineState.DRAFT);
    expect(await ctx.service.findForRoutine(ROUTINE_ID, TENANT_ID, as(UserRole.TEACHER))).toEqual(
      [],
    );
  });
  it('DRAFT + ADMIN returns all slots', async () => {
    const ctx = buildService();
    seed(ctx, RoutineState.DRAFT);
    expect(
      await ctx.service.findForRoutine(ROUTINE_ID, TENANT_ID, as(UserRole.ADMIN)),
    ).toHaveLength(2);
  });
  it('REVIEW + TEACHER returns only own slots', async () => {
    const ctx = buildService();
    seed(ctx, RoutineState.REVIEW);
    const r = await ctx.service.findForRoutine(ROUTINE_ID, TENANT_ID, as(UserRole.TEACHER));
    expect(r.map((x) => x.slot.id)).toEqual(['s1']);
  });
  it('REVIEW + PARENT returns []', async () => {
    const ctx = buildService();
    seed(ctx, RoutineState.REVIEW);
    expect(await ctx.service.findForRoutine(ROUTINE_ID, TENANT_ID, as(UserRole.PARENT))).toEqual(
      [],
    );
  });
  it('REVIEW + non-TEACHER staff with a teacher profile returns own slots (same rule as resolve)', async () => {
    const ctx = buildService();
    seed(ctx, RoutineState.REVIEW);
    const r = await ctx.service.findForRoutine(ROUTINE_ID, TENANT_ID, as(UserRole.OFFICE_STAFF));
    expect(r.map((x) => x.slot.id)).toEqual(['s1']);
  });
  it('REVIEW + non-TEACHER staff without a teacher profile returns []', async () => {
    const ctx = buildService();
    seed(ctx, RoutineState.REVIEW);
    ctx.teacherRepo.findOne = vi.fn(async () => null);
    expect(
      await ctx.service.findForRoutine(ROUTINE_ID, TENANT_ID, as(UserRole.OFFICE_STAFF)),
    ).toEqual([]);
  });
  it('REVIEW + EXECUTIVE (academic coordinator) returns every slot', async () => {
    const ctx = buildService();
    seed(ctx, RoutineState.REVIEW);
    expect(
      await ctx.service.findForRoutine(ROUTINE_ID, TENANT_ID, as(UserRole.EXECUTIVE)),
    ).toHaveLength(2);
  });
  it('DRAFT + EXECUTIVE returns []', async () => {
    const ctx = buildService();
    seed(ctx, RoutineState.DRAFT);
    expect(await ctx.service.findForRoutine(ROUTINE_ID, TENANT_ID, as(UserRole.EXECUTIVE))).toEqual(
      [],
    );
  });
  it('PUBLISHED + TEACHER returns all slots', async () => {
    const ctx = buildService();
    seed(ctx, RoutineState.PUBLISHED);
    expect(
      await ctx.service.findForRoutine(ROUTINE_ID, TENANT_ID, as(UserRole.TEACHER)),
    ).toHaveLength(2);
  });
  it('PUBLISHED + ADMIN returns all slots and never reads enrollments', async () => {
    const ctx = buildService();
    seed(ctx, RoutineState.PUBLISHED);
    expect(
      await ctx.service.findForRoutine(ROUTINE_ID, TENANT_ID, as(UserRole.ADMIN)),
    ).toHaveLength(2);
    // Staff path must stay untouched by the family filter.
    expect(ctx.enrollmentRepo.find).not.toHaveBeenCalled();
  });
  it('REVIEW + TEACHER role with no teacher row returns []', async () => {
    const ctx = buildService();
    seed(ctx, RoutineState.REVIEW);
    // No teacher profile means no "own" slots; must not fall through to all.
    ctx.teacherRepo.findOne = vi.fn(async () => null);
    expect(await ctx.service.findForRoutine(ROUTINE_ID, TENANT_ID, as(UserRole.TEACHER))).toEqual(
      [],
    );
  });
  it('REVIEW + empty userId returns [] without looking up a teacher', async () => {
    const ctx = buildService();
    seed(ctx, RoutineState.REVIEW);
    ctx.teacherRepo.findOne = vi.fn(async () => null);
    const r = await ctx.service.findForRoutine(ROUTINE_ID, TENANT_ID, {
      role: UserRole.OFFICE_STAFF,
      userId: '',
    });
    expect(r).toEqual([]);
    expect(ctx.teacherRepo.findOne).not.toHaveBeenCalled();
  });
  it.each([UserRole.PARENT, UserRole.STUDENT])(
    'PUBLISHED + %s sees only linked students sections',
    async (role) => {
      const ctx = buildService();
      seed(ctx, RoutineState.PUBLISHED);
      ctx.enrollmentRepo.find = vi.fn(async () => [{ section_id: 'sec-A' }]);
      const r = await ctx.service.findForRoutine(ROUTINE_ID, TENANT_ID, {
        role,
        userId: 'u1',
        familyStudentIds: ['stu-1'],
      });
      expect(r.map((x) => x.slot.id)).toEqual(['s1']);
      // Tenant, the routine's year and ACTIVE status bound the lookup.
      expect(ctx.enrollmentRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: TENANT_ID,
            academic_year_id: 'ay-1',
            enrollment_status: EnrollmentStatus.ACTIVE,
          }),
        }),
      );
    },
  );
  it('PUBLISHED + PARENT with no linked students returns [] and never reads slots', async () => {
    const ctx = buildService();
    seed(ctx, RoutineState.PUBLISHED);
    const r = await ctx.service.findForRoutine(ROUTINE_ID, TENANT_ID, {
      role: UserRole.PARENT,
      userId: 'u1',
      familyStudentIds: [],
    });
    expect(r).toEqual([]);
    expect(ctx.enrollmentRepo.find).not.toHaveBeenCalled();
    expect(ctx.slotRepo.find).not.toHaveBeenCalled();
  });
  it('PUBLISHED + PARENT without familyStudentIds fails closed', async () => {
    const ctx = buildService();
    seed(ctx, RoutineState.PUBLISHED);
    expect(await ctx.service.findForRoutine(ROUTINE_ID, TENANT_ID, as(UserRole.PARENT))).toEqual(
      [],
    );
  });
  it('PUBLISHED + PARENT whose child has no enrollment this year returns []', async () => {
    const ctx = buildService();
    seed(ctx, RoutineState.PUBLISHED);
    ctx.enrollmentRepo.find = vi.fn(async () => [{ section_id: null }]);
    const r = await ctx.service.findForRoutine(ROUTINE_ID, TENANT_ID, {
      role: UserRole.PARENT,
      userId: 'u1',
      familyStudentIds: ['stu-1'],
    });
    expect(r).toEqual([]);
  });
});
