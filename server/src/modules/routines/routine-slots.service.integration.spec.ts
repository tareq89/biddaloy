import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { User } from '../users/entities/user.entity';
import { Shift } from './entities/shift.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { Routine } from './entities/routine.entity';
import { RoutineSlotsService } from './routine-slots.service';
import { SchoolSettingsReader } from '../schools/settings/school-settings-reader.service';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { SchoolsService } from '../schools/schools.service';
import { RoutineSlot } from './entities/routine-slot.entity';
import { RoutineSubstitution } from './entities/routine-substitution.entity';
import { localToday } from '../attendance/attendance-policy.util';
import { PeriodSlotKind, RoutineState, SlotRecurrence } from '@biddaloy/shared';

/**
 * [21.4.1] D16 regression: `RoutineSlotsService.create()` writes
 * `routine_slots`/`routine_slot_teachers` through explicit repository
 * calls only, never by attaching a collection to a parent entity and
 * calling `save()` — the bug class documented on `Shift`'s docstring
 * (saving a parent with a tenant-filtered `@OneToMany` NULLs out other
 * tenants' rows on the far side of that relation). This runs the real
 * service against Postgres, not a mock, because that bug only shows up
 * against a real DB diff.
 */
describe('RoutineSlotsService — tenant isolation (D16)', () => {
  let dataSource: DataSource;
  let service: RoutineSlotsService;

  const TENANT_A = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000099';

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        RoutineSlotsService,
        AuditService,
        { provide: SchoolsService, useValue: { getResolvedSettings: async () => ({}) } },
        {
          provide: SchoolSettingsReader,
          useValue: { routineSettings: async () => ({}) },
        },
      ],
      [],
      { synchronize: true, dropSchema: true },
    );
    dataSource = module.get<DataSource>(getDataSourceToken());
    service = module.get<RoutineSlotsService>(RoutineSlotsService);

    const schoolRepo = dataSource.getRepository(School);
    await schoolRepo.save({ id: TENANT_A, name: 'Tenant A', slug: 'tenant-a' });
    await schoolRepo.save({ id: TENANT_B, name: 'Tenant B', slug: 'tenant-b' });
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function seedTenant(tenantId: string, suffix: string) {
    const yearRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);
    const sectionRepo = dataSource.getRepository(ClassSection);
    const subjectRepo = dataSource.getRepository(Subject);
    const shiftRepo = dataSource.getRepository(Shift);
    const periodSlotRepo = dataSource.getRepository(PeriodSlot);
    const routineRepo = dataSource.getRepository(Routine);
    const teacherRepo = dataSource.getRepository(Teacher);
    const userRepo = dataSource.getRepository(User);

    const year = await yearRepo.save({
      tenant_id: tenantId,
      name: `2026-${suffix}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      is_current: true,
    });
    const shift = await shiftRepo.save({
      tenant_id: tenantId,
      name: `Morning-${suffix}`,
      day_starts_at: '08:00:00',
      day_ends_at: '14:00:00',
      sequence: 0,
    });
    const periodSlot = await periodSlotRepo.save({
      tenant_id: tenantId,
      shift_id: shift.id,
      sequence: 0,
      kind: PeriodSlotKind.CLASS,
      starts_at: '08:00:00',
      ends_at: '08:40:00',
    });
    const klass = await classRepo.save({
      tenant_id: tenantId,
      academic_year_id: year.id,
      name: `Class-${suffix}`,
      shift_id: shift.id,
    });
    const section = await sectionRepo.save({
      tenant_id: tenantId,
      class_id: klass.id,
      section_name: 'A',
    });
    const subject = await subjectRepo.save({
      tenant_id: tenantId,
      name_en: `Subject-${suffix}`,
      code: `SUB-${suffix}`,
    });
    const user = await userRepo.save({
      full_name: `Teacher ${suffix}`,
      email: `teacher-${suffix}-${tenantId}@test.local`,
    });
    const teacher = await teacherRepo.save({
      tenant_id: tenantId,
      user_id: user.id,
      employee_id: `EMP-${suffix}-${tenantId}`,
    });
    const routine = await routineRepo.save({
      tenant_id: tenantId,
      academic_year_id: year.id,
      name: `Routine-${suffix}`,
      state: RoutineState.DRAFT,
      published_at: null,
    });

    return { routine, section, periodSlot, subject, teacher };
  }

  it('creating a slot for Tenant A leaves Tenant B slots/slot-teachers untouched', async () => {
    const a = await seedTenant(TENANT_A, 'a');
    const b = await seedTenant(TENANT_B, 'b');

    // Seed Tenant B with its own slot first, exactly the shape D16's bug
    // clobbers when a parent entity's collection is saved.
    const bResult = await service.create(
      b.routine.id,
      {
        section_id: b.section.id,
        period_slot_id: b.periodSlot.id,
        weekday: 1,
        subject_id: b.subject.id,
        room_id: null,
        recurrence: SlotRecurrence.WEEKLY,
        recurrence_offset: 0,
        valid_from: '2026-01-01',
        valid_to: null,
        teacher_ids: [b.teacher.id],
      } as any,
      TENANT_B,
    );

    // Now write a slot for Tenant A.
    await service.create(
      a.routine.id,
      {
        section_id: a.section.id,
        period_slot_id: a.periodSlot.id,
        weekday: 1,
        subject_id: a.subject.id,
        room_id: null,
        recurrence: SlotRecurrence.WEEKLY,
        recurrence_offset: 0,
        valid_from: '2026-01-01',
        valid_to: null,
        teacher_ids: [a.teacher.id],
      } as any,
      TENANT_A,
    );

    const bSlots = await service.findForRoutine(b.routine.id, TENANT_B);
    expect(bSlots).toHaveLength(1);
    expect(bSlots[0].slot.id).toBe(bResult.slot.id);
    expect(bSlots[0].teacher_ids).toEqual([b.teacher.id]);
  });

  // --- [68.3.x TIME-08] published-routine slot guard ---

  function addDays(d: string, n: number): string {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  }

  async function publishedSlot(tenantId: string, suffix: string, validFrom: string) {
    const t = await seedTenant(tenantId, suffix);
    await dataSource
      .getRepository(Routine)
      .update({ id: t.routine.id }, { state: RoutineState.PUBLISHED, published_at: new Date() });
    const created = await service.create(
      t.routine.id,
      {
        section_id: t.section.id,
        period_slot_id: t.periodSlot.id,
        weekday: 1,
        subject_id: t.subject.id,
        room_id: null,
        recurrence: SlotRecurrence.WEEKLY,
        recurrence_offset: 0,
        valid_from: validFrom,
        valid_to: null,
        teacher_ids: [t.teacher.id],
      } as any,
      tenantId,
    );
    return { ...t, slot: created.slot };
  }

  let n = 0;
  async function freshTenant() {
    const id = `00000000-0000-4000-8000-00000000${String(100 + ++n).padStart(4, '0')}`;
    await dataSource.getRepository(School).save({ id, name: id, slug: id });
    return id;
  }
  async function auditRows(tenantId: string) {
    return dataSource.getRepository(AuditLog).find({
      where: { tenant_id: tenantId, entity_type: 'RoutineSlot' },
    });
  }

  it('remove a published slot that started last month: end-dated, substitutions survive, audit UPDATE', async () => {
    const tid = await freshTenant();
    const today = localToday('UTC');
    const p = await publishedSlot(tid, 'g1', addDays(today, -30));
    const user = await dataSource.getRepository(User).save({
      full_name: 'Admin g1',
      email: `admin-g1-${tid}@test.local`,
    });
    await dataSource.getRepository(RoutineSubstitution).save({
      tenant_id: tid,
      routine_slot_id: p.slot.id,
      date: addDays(today, -10),
      substitute_teacher_id: null,
      is_cancelled: true,
      created_by: user.id,
    });

    await service.remove(p.slot.id, tid, user.id);

    const row = await dataSource.getRepository(RoutineSlot).findOneBy({ id: p.slot.id });
    expect(row?.valid_to).toBe(addDays(today, -1));
    expect(
      await dataSource.getRepository(RoutineSubstitution).countBy({ routine_slot_id: p.slot.id }),
    ).toBe(1);
    const audit = await auditRows(tid);
    expect(audit.filter((a) => a.action === 'UPDATE')).toHaveLength(1);
  });

  it('remove a published slot whose valid_from is tomorrow: row gone, audit DELETE', async () => {
    const tid = await freshTenant();
    const p = await publishedSlot(tid, 'g2', addDays(localToday('UTC'), 1));
    const user = await dataSource.getRepository(User).save({
      full_name: 'Admin g2',
      email: `admin-g2-${tid}@test.local`,
    });
    await service.remove(p.slot.id, tid, user.id);
    expect(await dataSource.getRepository(RoutineSlot).findOneBy({ id: p.slot.id })).toBeNull();
    expect((await auditRows(tid)).filter((a) => a.action === 'DELETE')).toHaveLength(1);
  });

  it('remove an already-ended published slot -> 409 ROUTINE_SLOT_ALREADY_ENDED', async () => {
    const tid = await freshTenant();
    const today = localToday('UTC');
    const p = await publishedSlot(tid, 'g3', addDays(today, -30));
    await dataSource
      .getRepository(RoutineSlot)
      .update({ id: p.slot.id }, { valid_to: addDays(today, -5) });
    await expect(service.remove(p.slot.id, tid, null as any)).rejects.toMatchObject({
      response: { details: { code: 'ROUTINE_SLOT_ALREADY_ENDED' } },
      status: 409,
    });
  });

  it('update a published slot with valid_from last week -> 422 ROUTINE_SLOT_BACKDATED', async () => {
    const tid = await freshTenant();
    const today = localToday('UTC');
    const p = await publishedSlot(tid, 'g4', addDays(today, -60));
    await expect(
      service.update(
        p.slot.id,
        {
          section_id: p.section.id,
          period_slot_id: p.periodSlot.id,
          weekday: 1,
          subject_id: p.subject.id,
          room_id: null,
          recurrence: SlotRecurrence.WEEKLY,
          recurrence_offset: 0,
          valid_from: addDays(today, -7),
          valid_to: null,
          teacher_ids: [p.teacher.id],
        } as any,
        tid,
        null as any,
      ),
    ).rejects.toMatchObject({
      response: { details: { code: 'ROUTINE_SLOT_BACKDATED' } },
      status: 422,
    });
  });

  it('update a draft slot with a past valid_from still works', async () => {
    const tid = await freshTenant();
    const t = await seedTenant(tid, 'g5');
    const dto = {
      section_id: t.section.id,
      period_slot_id: t.periodSlot.id,
      weekday: 1,
      subject_id: t.subject.id,
      room_id: null,
      recurrence: SlotRecurrence.WEEKLY,
      recurrence_offset: 0,
      valid_from: '2026-01-01',
      valid_to: null,
      teacher_ids: [t.teacher.id],
    } as any;
    const created = await service.create(t.routine.id, dto, tid);
    const res = await service.update(
      created.slot.id,
      { ...dto, valid_from: '2026-02-01' },
      tid,
      null as any,
    );
    expect(res.slot.valid_from).toBe('2026-02-01');
  });

  it('tenant B cannot remove tenant A slot (404)', async () => {
    const a = await freshTenant();
    const b = await freshTenant();
    const p = await publishedSlot(a, 'g6', addDays(localToday('UTC'), -30));
    await expect(service.remove(p.slot.id, b, null as any)).rejects.toThrow(/not found/);
  });
});
