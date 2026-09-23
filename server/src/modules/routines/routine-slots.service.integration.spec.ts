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
});
