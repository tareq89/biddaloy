import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { PeriodSlotKind, RoutineState, SlotRecurrence } from '@biddaloy/shared';
import { ResolveRoutineService } from './resolve-routine.service';
import { CalendarModule } from '../calendar/calendar.module';
import { AuthModule } from '../auth/auth.module';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../calendar/entities/calendar-event-class.entity';
import { Shift } from './entities/shift.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { Routine } from './entities/routine.entity';
import { RoutineSlot } from './entities/routine-slot.entity';

/**
 * [66.0.02] Real DB, real SchoolCalendarService: a holiday scoped to one
 * class removes only that class's occurrences from the resolver.
 * Mon 2043-03-02 .. Wed 2043-03-04; the holiday is on Tue the 3rd.
 */
describe('ResolveRoutineService — class-scoped holidays (integration)', () => {
  let ds: DataSource;
  let service: ResolveRoutineService;
  const TENANT_B = '00000000-0000-4000-8000-0000000066b2';
  const DAYS = ['2043-03-02', '2043-03-03', '2043-03-04'];
  const HOLIDAY = '2043-03-03';
  let yearId: string;
  let sectionA: string; // class "Nine"
  let sectionB: string; // class "Eleven"
  let classA: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [ResolveRoutineService],
      [ConfigModule.forRoot({ isGlobal: true }), CalendarModule, AuthModule],
    );
    ds = module.get<DataSource>(getDataSourceToken());
    service = module.get(ResolveRoutineService);
    if (!(await ds.getRepository(School).findOne({ where: { id: TENANT_B } }))) {
      await ds.getRepository(School).save({ id: TENANT_B, name: 'CH Other', slug: 'ch-other-66' });
    }
    // Reference row (survives per-test resets); 2043 overlaps no other spec's year.
    const yearRepo = ds.getRepository(AcademicYear);
    const where = { tenant_id: SEED_TENANT_ID, name: 'CH Class Holiday 2043' };
    yearId = (
      (await yearRepo.findOne({ where })) ??
      (await yearRepo.save({
        ...where,
        start_date: '2043-01-01',
        end_date: '2043-12-31',
        is_current: false,
      }))
    ).id;
  }, 60000);

  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM calendar_events');
    await ds
      .getRepository(School)
      .update(
        { id: SEED_TENANT_ID },
        { settings: { version: 1, attendance: { weeklyOffDays: [] } } as never },
      );
    const suffix = Math.random().toString(36).slice(2, 8);
    const mk = async (name: string) => {
      const c = await ds
        .getRepository(Class)
        .save({ name: `${name} ${suffix}`, academic_year_id: yearId, tenant_id: SEED_TENANT_ID });
      const s = await ds
        .getRepository(ClassSection)
        .save({ class_id: c.id, section_name: 'A', tenant_id: SEED_TENANT_ID });
      return { classId: c.id, sectionId: s.id };
    };
    ({ classId: classA, sectionId: sectionA } = await mk('Nine'));
    ({ sectionId: sectionB } = await mk('Eleven'));

    const shift = await ds.getRepository(Shift).save({
      tenant_id: SEED_TENANT_ID,
      name: `CH-${suffix}`,
      day_starts_at: '08:00:00',
      day_ends_at: '14:00:00',
      sequence: 0,
    });
    const period = await ds.getRepository(PeriodSlot).save({
      tenant_id: SEED_TENANT_ID,
      shift_id: shift.id,
      sequence: 0,
      kind: PeriodSlotKind.CLASS,
      starts_at: '08:00:00',
      ends_at: '08:40:00',
    });
    const subject = await ds
      .getRepository(Subject)
      .save({
        tenant_id: SEED_TENANT_ID,
        code: suffix,
        name_en: `Sub ${suffix}`,
        name_bn: 'বি',
      });
    const routine = await ds.getRepository(Routine).save({
      tenant_id: SEED_TENANT_ID,
      academic_year_id: yearId,
      name: 'CH Routine',
      state: RoutineState.PUBLISHED,
      published_at: new Date(),
    });
    // One slot per weekday (Mon..Wed) for each section.
    for (const section_id of [sectionA, sectionB]) {
      for (const weekday of [1, 2, 3]) {
        await ds.getRepository(RoutineSlot).save({
          tenant_id: SEED_TENANT_ID,
          routine_id: routine.id,
          section_id,
          period_slot_id: period.id,
          weekday,
          subject_id: subject.id,
          recurrence: SlotRecurrence.WEEKLY,
          recurrence_offset: 0,
          valid_from: '2043-01-01',
          valid_to: null,
        });
      }
    }
  });

  async function holiday(opts: {
    classIds: string[];
    published?: boolean;
    countsAsWorking?: boolean;
    tenantId?: string;
    yearId?: string;
  }) {
    const tenant_id = opts.tenantId ?? SEED_TENANT_ID;
    const event = await ds.getRepository(CalendarEvent).save({
      tenant_id,
      academic_year_id: opts.yearId ?? yearId,
      start_date: HOLIDAY,
      end_date: HOLIDAY,
      name: 'Scoped Break',
      counts_as_working_day: opts.countsAsWorking ?? false,
      published_at: opts.published === false ? null : new Date(),
    });
    for (const class_id of opts.classIds) {
      await ds.getRepository(CalendarEventClass).save({ event_id: event.id, class_id, tenant_id });
    }
  }

  const datesFor = async (sectionId: string) =>
    (
      await service.resolveRoutine(
        { section_id: sectionId, from: DAYS[0], to: DAYS[2] } as never,
        SEED_TENANT_ID,
        { role: 'ADMIN', userId: 'unused' },
      )
    ).map((r) => r.date);

  it('class-scoped holiday: that class loses the day, the other keeps all three', async () => {
    await holiday({ classIds: [classA] });
    expect(await datesFor(sectionA)).toEqual([DAYS[0], DAYS[2]]);
    expect(await datesFor(sectionB)).toEqual(DAYS);
  });

  it('school-wide holiday: both classes lose the day', async () => {
    await holiday({ classIds: [] });
    expect(await datesFor(sectionA)).toEqual([DAYS[0], DAYS[2]]);
    expect(await datesFor(sectionB)).toEqual([DAYS[0], DAYS[2]]);
  });

  it('draft class holiday: nobody loses a day', async () => {
    await holiday({ classIds: [classA], published: false });
    expect(await datesFor(sectionA)).toEqual(DAYS);
  });

  it('counts-as-working-day class event: nobody loses a day', async () => {
    await holiday({ classIds: [classA], countsAsWorking: true });
    expect(await datesFor(sectionA)).toEqual(DAYS);
  });

  it('tenant isolation: a tenant-B holiday scoped to a tenant-B class does not touch tenant A', async () => {
    const yearB = await ds.getRepository(AcademicYear).save({
      tenant_id: TENANT_B,
      name: `CH B ${Math.random().toString(36).slice(2, 8)}`,
      start_date: '2043-01-01',
      end_date: '2043-12-31',
      is_current: false,
    });
    const classOfB = await ds
      .getRepository(Class)
      .save({ name: 'Nine', academic_year_id: yearB.id, tenant_id: TENANT_B });
    await holiday({ classIds: [classOfB.id], tenantId: TENANT_B, yearId: yearB.id });
    expect(await datesFor(sectionA)).toEqual(DAYS);
  });
});
