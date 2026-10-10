import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_TENANT_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_ADMIN_USER_ID,
} from '@test/constants';
import { PeriodSlotKind, RoutineState, SlotRecurrence } from '@biddaloy/shared';
import { ResolveRoutineService } from './resolve-routine.service';
import { SchoolCalendarService } from '../calendar/school-calendar.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Subject } from '../academics/entities/subject.entity';
import { Shift } from './entities/shift.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { Routine } from './entities/routine.entity';
import { RoutineSlot } from './entities/routine-slot.entity';
import { RoutineSubstitution } from './entities/routine-substitution.entity';
import { User } from '../users/entities/user.entity';
import { Teacher } from '../academics/entities/teacher.entity';

/**
 * [31.3.7c] Each resolved slot carries its subject's English and Bangla
 * name, because families get 403 on `GET /subjects`. Real DB: the lookup is
 * tenant-scoped by hand and must still name a soft-deleted subject.
 * Routines/slots/subjects are wiped before every test, so they are
 * re-seeded in `beforeEach`; the 2041 academic year is a reference row.
 */
describe('ResolveRoutineService — subject names (integration)', () => {
  let dataSource: DataSource;
  let service: ResolveRoutineService;

  const TENANT_B = '00000000-0000-4000-8000-0000000007c3';
  const MONDAY = '2041-03-04'; // weekday 1
  let periodSlotId: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        ResolveRoutineService,
        {
          provide: SchoolCalendarService,
          useValue: { getWorkingDays: async () => ({ dates: [MONDAY] }) },
        },
      ],
      [],
    );
    dataSource = module.get<DataSource>(getDataSourceToken());
    service = module.get(ResolveRoutineService);

    await dataSource
      .getRepository(School)
      .save({ id: TENANT_B, name: 'Resolve Other School', slug: 'resolve-other' });

    const yearRepo = dataSource.getRepository(AcademicYear);
    const existing = await yearRepo.findOne({
      where: { tenant_id: SEED_TENANT_ID, name: 'Resolve Names 2041' },
    });
    if (!existing) {
      await yearRepo.save({
        tenant_id: SEED_TENANT_ID,
        name: 'Resolve Names 2041',
        start_date: '2041-01-01',
        end_date: '2041-12-31',
        is_current: false,
      });
    }
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    const year = await dataSource
      .getRepository(AcademicYear)
      .findOneOrFail({ where: { tenant_id: SEED_TENANT_ID, name: 'Resolve Names 2041' } });
    const shift = await dataSource.getRepository(Shift).save({
      tenant_id: SEED_TENANT_ID,
      name: `Resolve-${Math.random().toString(36).slice(2, 8)}`,
      day_starts_at: '08:00:00',
      day_ends_at: '14:00:00',
      sequence: 0,
    });
    periodSlotId = (
      await dataSource.getRepository(PeriodSlot).save({
        tenant_id: SEED_TENANT_ID,
        shift_id: shift.id,
        sequence: 0,
        kind: PeriodSlotKind.CLASS,
        starts_at: '08:00:00',
        ends_at: '08:40:00',
      })
    ).id;
    await dataSource.getRepository(Routine).save({
      tenant_id: SEED_TENANT_ID,
      academic_year_id: year.id,
      name: 'Resolve Names Routine',
      state: RoutineState.PUBLISHED,
      published_at: new Date(),
    });
  });

  async function addSlot(subjectId: string): Promise<void> {
    const routine = await dataSource
      .getRepository(Routine)
      .findOneOrFail({ where: { tenant_id: SEED_TENANT_ID, name: 'Resolve Names Routine' } });
    await dataSource.getRepository(RoutineSlot).save({
      tenant_id: SEED_TENANT_ID,
      routine_id: routine.id,
      section_id: SEED_SECTION_1_ID,
      period_slot_id: periodSlotId,
      weekday: 1,
      subject_id: subjectId,
      recurrence: SlotRecurrence.WEEKLY,
      recurrence_offset: 0,
      valid_from: '2041-01-01',
      valid_to: null,
    });
  }

  const resolve = () =>
    service.resolveRoutine(
      { section_id: SEED_SECTION_1_ID, from: MONDAY, to: MONDAY } as never,
      SEED_TENANT_ID,
      {
        role: 'ADMIN',
        userId: 'unused',
      },
    );

  const subjectRepo = () => dataSource.getRepository(Subject);

  it('names the slot subject in English and Bangla', async () => {
    const subject = await subjectRepo().save({
      tenant_id: SEED_TENANT_ID,
      name_en: 'Science',
      name_bn: 'বিজ্ঞান',
      code: 'RSV-S',
    });
    await addSlot(subject.id);

    const slots = await resolve();

    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ subject_name_en: 'Science', subject_name_bn: 'বিজ্ঞান' });
  });

  it('still names a soft-deleted subject', async () => {
    const subject = await subjectRepo().save({
      tenant_id: SEED_TENANT_ID,
      name_en: 'Drawing',
      name_bn: 'চারুকলা',
      code: 'RSV-D',
    });
    await addSlot(subject.id);
    await subjectRepo().softDelete({ id: subject.id });

    const slots = await resolve();

    expect(slots[0]).toMatchObject({ subject_name_en: 'Drawing', subject_name_bn: 'চারুকলা' });
  });

  it("never names another tenant's subject", async () => {
    const foreign = await subjectRepo().save({
      tenant_id: TENANT_B,
      name_en: 'Secret',
      name_bn: 'গোপন',
      code: 'RSV-X',
    });
    await addSlot(foreign.id);

    const slots = await resolve();

    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ subject_name_en: null, subject_name_bn: null });
  });
});

/**
 * [67.3.03] `resolveTenantDay`: the whole school's published timetable for
 * one date in one call (used by Epic 67 background rules).
 */
describe('[67.3.03] resolveTenantDay (integration)', () => {
  let ds: DataSource;
  let service: ResolveRoutineService;
  let workingDates: string[];

  const TENANT_B = '00000000-0000-4000-8000-0000000067b3';
  const DAY = '2042-03-03'; // a Monday, weekday 1
  let yearId: string;
  let yearBId: string;
  let periodSlotId: string;
  let subjectId: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        ResolveRoutineService,
        {
          provide: SchoolCalendarService,
          useValue: { getWorkingDays: async () => ({ dates: workingDates }) },
        },
      ],
      [],
    );
    ds = module.get<DataSource>(getDataSourceToken());
    service = module.get(ResolveRoutineService);
    await ds
      .getRepository(School)
      .save({ id: TENANT_B, name: 'Tenant Day Other', slug: 'tenant-day-other' });
    const yearRepo = ds.getRepository(AcademicYear);
    const mkYear = async (tenantId: string) => {
      const found = await yearRepo.findOne({
        where: { tenant_id: tenantId, name: 'Tenant Day 2042' },
      });
      return (
        found ??
        (await yearRepo.save({
          tenant_id: tenantId,
          name: 'Tenant Day 2042',
          start_date: '2042-01-01',
          end_date: '2042-12-31',
          is_current: false,
        }))
      ).id;
    };
    yearId = await mkYear(SEED_TENANT_ID);
    yearBId = await mkYear(TENANT_B);
  }, 60000);

  afterAll(async () => {
    await ds.destroy();
  });

  const mkTeacher = async () => {
    const user = await ds.getRepository(User).save({
      full_name: 'Day Teacher',
      email: `day-${Math.random().toString(36).slice(2, 10)}@test.com`,
    });
    return ds.getRepository(Teacher).save({
      user_id: user.id,
      employee_id: `DAY-${Math.random().toString(36).slice(2, 8)}`,
      designations: [],
      tenant_id: SEED_TENANT_ID,
    });
  };

  const mkRoutine = async (state: RoutineState) =>
    (
      await ds.getRepository(Routine).save({
        tenant_id: SEED_TENANT_ID,
        academic_year_id: yearId,
        name: 'Tenant Day Routine',
        state,
        published_at: state === RoutineState.PUBLISHED ? new Date() : null,
      })
    ).id;

  const mkSlot = (routineId: string, sectionId: string) =>
    ds.getRepository(RoutineSlot).save({
      tenant_id: SEED_TENANT_ID,
      routine_id: routineId,
      section_id: sectionId,
      period_slot_id: periodSlotId,
      weekday: 1,
      subject_id: subjectId,
      recurrence: SlotRecurrence.WEEKLY,
      recurrence_offset: 0,
      valid_from: '2042-01-01',
      valid_to: null,
    });

  beforeEach(async () => {
    workingDates = [DAY];
    for (const [t, y] of [
      [SEED_TENANT_ID, yearId],
      [TENANT_B, yearBId],
    ]) {
      await ds.query(
        `DELETE FROM routine_substitutions WHERE tenant_id = $1 AND routine_slot_id IN (SELECT rs.id FROM routine_slots rs JOIN routines r ON r.id = rs.routine_id WHERE r.academic_year_id = $2)`,
        [t, y],
      );
      await ds.query(
        `DELETE FROM routine_slots WHERE tenant_id = $1 AND routine_id IN (SELECT id FROM routines WHERE academic_year_id = $2)`,
        [t, y],
      );
      await ds.query(`DELETE FROM routines WHERE tenant_id = $1 AND academic_year_id = $2`, [t, y]);
    }
    const shift = await ds.getRepository(Shift).save({
      tenant_id: SEED_TENANT_ID,
      name: `Day-${Math.random().toString(36).slice(2, 8)}`,
      day_starts_at: '08:00:00',
      day_ends_at: '14:00:00',
      sequence: 0,
    });
    periodSlotId = (
      await ds.getRepository(PeriodSlot).save({
        tenant_id: SEED_TENANT_ID,
        shift_id: shift.id,
        sequence: 0,
        kind: PeriodSlotKind.CLASS,
        starts_at: '08:00:00',
        ends_at: '08:40:00',
      })
    ).id;
    subjectId = (
      await ds.getRepository(Subject).save({
        tenant_id: SEED_TENANT_ID,
        name_en: 'Day',
        name_bn: 'দিন',
        code: `TD-${Math.random().toString(36).slice(2, 7)}`,
      })
    ).id;
  });

  it('published routine: slots of every section for the date', async () => {
    const routineId = await mkRoutine(RoutineState.PUBLISHED);
    await mkSlot(routineId, SEED_SECTION_1_ID);
    await mkSlot(routineId, SEED_SECTION_2_ID);
    const slots = await service.resolveTenantDay(SEED_TENANT_ID, DAY);
    expect(slots.map((s) => s.section_id).sort()).toEqual(
      [SEED_SECTION_1_ID, SEED_SECTION_2_ID].sort(),
    );
    expect(slots.every((s) => s.date === DAY)).toBe(true);
  });

  it.each([RoutineState.DRAFT, RoutineState.REVIEW])(
    '%s routine resolves to nothing',
    async (state) => {
      const routineId = await mkRoutine(state);
      await mkSlot(routineId, SEED_SECTION_1_ID);
      expect(await service.resolveTenantDay(SEED_TENANT_ID, DAY)).toEqual([]);
    },
  );

  it('applies a cancellation and a covering substitute', async () => {
    const routineId = await mkRoutine(RoutineState.PUBLISHED);
    const s1 = await mkSlot(routineId, SEED_SECTION_1_ID);
    const s2 = await mkSlot(routineId, SEED_SECTION_2_ID);
    const substitute = await mkTeacher();
    await ds.getRepository(RoutineSubstitution).save([
      {
        tenant_id: SEED_TENANT_ID,
        routine_slot_id: s1.id,
        date: DAY,
        is_cancelled: true,
        created_by: SEED_ADMIN_USER_ID,
      },
      {
        tenant_id: SEED_TENANT_ID,
        routine_slot_id: s2.id,
        date: DAY,
        substitute_teacher_id: substitute.id,
        is_cancelled: false,
        created_by: SEED_ADMIN_USER_ID,
      },
    ]);
    const slots = await service.resolveTenantDay(SEED_TENANT_ID, DAY);
    expect(slots.find((s) => s.routine_slot_id === s1.id)?.cancelled).toBe(true);
    expect(slots.find((s) => s.routine_slot_id === s2.id)?.teacher_ids).toEqual([substitute.id]);
  });

  it('a non-working date resolves to nothing', async () => {
    const routineId = await mkRoutine(RoutineState.PUBLISHED);
    await mkSlot(routineId, SEED_SECTION_1_ID);
    workingDates = [];
    expect(await service.resolveTenantDay(SEED_TENANT_ID, DAY)).toEqual([]);
  });

  it("never returns another tenant's routine", async () => {
    // Tenant A has a published routine for the date; tenant B has none.
    const routineId = await mkRoutine(RoutineState.PUBLISHED);
    await mkSlot(routineId, SEED_SECTION_1_ID);
    expect(await service.resolveTenantDay(TENANT_B, DAY)).toEqual([]);
  });
});
