import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { CalendarModule } from './calendar.module';
import { AuthModule } from '../auth/auth.module';
import { SchoolCalendarService } from './school-calendar.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarEventClass } from './entities/calendar-event-class.entity';
import { Class } from '../academics/entities/class.entity';
import { SchoolsService } from '../schools/schools.service';
import { CalendarEventType } from '@biddaloy/shared';
import { TenantSettingsDto } from '../schools/dto/tenant-settings.dto';

/**
 * Integration tests for `SchoolCalendarService`'s working-day math — the
 * one place `AttendanceService` ([9.3]) and `AttendanceSummaryService`
 * ([9.4]) both read "is this a school day". Moved verbatim from
 * `academics/school-calendar.service.integration.spec.ts` in [17.1.2],
 * with `SchoolHoliday` swapped for `CalendarEvent` and `published_at` set
 * on every directly-inserted fixture (see D9 — a draft never affects
 * working-day math). Runs against a real, migrated test database.
 *
 * `weeklyOffDays: []` is set for every tenant in `beforeEach` so the
 * expected working-day counts below are pinned to the fixed date range
 * used in each test, independent of which day of the week the test runs
 * on. The one weekly-off-specific test overrides it back to `[5]`
 * (Friday, the tenant default) explicitly.
 */
describe('SchoolCalendarService (integration)', () => {
  let service: SchoolCalendarService;
  let dataSource: DataSource;
  let schoolsService: SchoolsService;

  const TENANT_A = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000099';
  let academicYearAId: string;
  let academicYearBId: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), CalendarModule, AuthModule],
    );
    service = module.get<SchoolCalendarService>(SchoolCalendarService);
    dataSource = module.get<DataSource>(getDataSourceToken());
    schoolsService = module.get(SchoolsService, { strict: false });

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: TENANT_B } }))) {
      await schoolRepo.save({ id: TENANT_B, name: 'Other School', slug: 'other-school-9-4' });
    }

    const yearRepo = dataSource.getRepository(AcademicYear);
    const yearA = await yearRepo.save({
      name: 'School Calendar Test Year A',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_A,
    });
    academicYearAId = yearA.id;
    const yearB = await yearRepo.save({
      name: 'School Calendar Test Year B',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_B,
    });
    academicYearBId = yearB.id;
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function setWeeklyOffDays(tenantId: string, weeklyOffDays: number[]): Promise<void> {
    await dataSource
      .getRepository(School)
      .update({ id: tenantId }, { settings: { version: 1, attendance: { weeklyOffDays } } as any });
  }

  beforeEach(async () => {
    // calendar_events is a "transactional" table for this suite's purposes
    // — reseed per test rather than relying on file-level fixtures.
    await dataSource.query('DELETE FROM calendar_events');
    await setWeeklyOffDays(TENANT_A, []);
    await setWeeklyOffDays(TENANT_B, []);
  });

  describe('getWorkingDays', () => {
    it('excludes weekly off days', async () => {
      // 2026-09-01 is a Tuesday; 2026-09-07 is a Monday — a 7-day range
      // with Friday (2026-09-04) as the weekly off day.
      await setWeeklyOffDays(TENANT_A, [5]);
      const result = await service.getWorkingDays({
        tenantId: TENANT_A,
        from: '2026-09-01',
        to: '2026-09-07',
      });
      expect(result.dates).not.toContain('2026-09-04');
      expect(result.count).toBe(6);
    });

    it('[TIME-02] a later weekly-off change does not rewrite past dates', async () => {
      await setWeeklyOffDays(TENANT_A, [5, 6]);
      const range = { tenantId: TENANT_A, from: '2025-03-02', to: '2025-03-08' };
      expect((await service.getWorkingDays(range)).count).toBe(5);

      const current = (await dataSource.getRepository(School).findOneByOrFail({ id: TENANT_A }))
        .settings as { attendance: Record<string, unknown> };
      await schoolsService.updateSettings(
        TENANT_A,
        {
          version: 1,
          attendance: { ...current.attendance, weeklyOffDays: [5] },
        } as unknown as TenantSettingsDto,
        SEED_ADMIN_USER_ID,
      );

      expect((await service.getWorkingDays(range)).count).toBe(5);
      // a future Saturday is now a working day
      const future = await service.getWorkingDays({
        tenantId: TENANT_A,
        from: '2099-01-03',
        to: '2099-01-03',
      });
      expect(future.dates).toEqual(['2099-01-03']);
    });

    it('excludes a multi-day holiday', async () => {
      await dataSource.getRepository(CalendarEvent).save({
        tenant_id: TENANT_A,
        academic_year_id: academicYearAId,
        start_date: '2026-09-02',
        end_date: '2026-09-03',
        name: 'Eid Break',
        counts_as_working_day: false,
        published_at: new Date(),
      });
      const result = await service.getWorkingDays({
        tenantId: TENANT_A,
        from: '2026-09-01',
        to: '2026-09-05',
      });
      expect(result.dates).toEqual(['2026-09-01', '2026-09-04', '2026-09-05']);
      expect(result.count).toBe(3);
    });

    it('keeps a holiday whose counts_as_working_day is true', async () => {
      await dataSource.getRepository(CalendarEvent).save({
        tenant_id: TENANT_A,
        academic_year_id: academicYearAId,
        start_date: '2026-09-02',
        end_date: '2026-09-02',
        name: 'Half-Yearly Exam',
        counts_as_working_day: true,
        published_at: new Date(),
      });
      const result = await service.getWorkingDays({
        tenantId: TENANT_A,
        from: '2026-09-01',
        to: '2026-09-03',
      });
      expect(result.dates).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
      expect(result.count).toBe(3);
    });

    it('counts overlapping holidays once, not once per overlapping row', async () => {
      const holidayRepo = dataSource.getRepository(CalendarEvent);
      await holidayRepo.save({
        tenant_id: TENANT_A,
        academic_year_id: academicYearAId,
        start_date: '2026-09-02',
        end_date: '2026-09-04',
        name: 'Holiday A',
        counts_as_working_day: false,
        published_at: new Date(),
      });
      await holidayRepo.save({
        tenant_id: TENANT_A,
        academic_year_id: academicYearAId,
        start_date: '2026-09-03',
        end_date: '2026-09-05',
        name: 'Holiday B',
        counts_as_working_day: false,
        published_at: new Date(),
      });
      const result = await service.getWorkingDays({
        tenantId: TENANT_A,
        from: '2026-09-01',
        to: '2026-09-06',
      });
      // Only 2026-09-01 and 2026-09-06 remain: 02-05 is removed by the
      // union of the two overlapping holidays.
      expect(result.dates).toEqual(['2026-09-01', '2026-09-06']);
    });

    it('rejects a range wider than 400 days with a 422', async () => {
      await expect(
        service.getWorkingDays({ tenantId: TENANT_A, from: '2026-01-01', to: '2027-06-01' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it("does not let tenant B's holiday shrink tenant A's working days", async () => {
      await dataSource.getRepository(CalendarEvent).save({
        tenant_id: TENANT_B,
        academic_year_id: academicYearBId,
        start_date: '2026-09-02',
        end_date: '2026-09-02',
        name: 'Tenant B Holiday',
        counts_as_working_day: false,
        published_at: new Date(),
      });
      const result = await service.getWorkingDays({
        tenantId: TENANT_A,
        from: '2026-09-01',
        to: '2026-09-03',
      });
      expect(result.dates).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
      expect(result.count).toBe(3);
    });

    // [17.1.2] D9 — new case: a draft holiday (published_at IS NULL) is on
    // the calendar but must not affect working-day math.
    it('does not let a draft holiday (published_at null) remove a working day', async () => {
      await dataSource.getRepository(CalendarEvent).save({
        tenant_id: TENANT_A,
        academic_year_id: academicYearAId,
        start_date: '2026-09-02',
        end_date: '2026-09-02',
        name: 'Draft Holiday',
        counts_as_working_day: false,
        published_at: null,
      });
      const result = await service.getWorkingDays({
        tenantId: TENANT_A,
        from: '2026-09-01',
        to: '2026-09-03',
      });
      expect(result.dates).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
      expect(result.count).toBe(3);
    });
  });

  describe('getWorkingDays with classId (D25)', () => {
    let class9: string;
    let class11: string;

    beforeAll(async () => {
      const repo = dataSource.getRepository(Class);
      class9 = (
        await repo.save({ name: 'Cal 9', academic_year_id: academicYearAId, tenant_id: TENANT_A })
      ).id;
      class11 = (
        await repo.save({ name: 'Cal 11', academic_year_id: academicYearAId, tenant_id: TENANT_A })
      ).id;
    });

    async function holiday(scopedTo: string[], published = true): Promise<void> {
      const event = await dataSource.getRepository(CalendarEvent).save({
        tenant_id: TENANT_A,
        academic_year_id: academicYearAId,
        start_date: '2026-09-02',
        end_date: '2026-09-02',
        name: 'Scoped Break',
        counts_as_working_day: false,
        published_at: published ? new Date() : null,
      });
      for (const classId of scopedTo) {
        await dataSource
          .getRepository(CalendarEventClass)
          .save({ event_id: event.id, class_id: classId, tenant_id: TENANT_A });
      }
    }
    const count = (classId?: string) =>
      service
        .getWorkingDays({ tenantId: TENANT_A, from: '2026-09-01', to: '2026-09-03', classId })
        .then((r) => r.count);

    it('a school-wide event counts for any class and for none', async () => {
      await holiday([]);
      expect(await count(class9)).toBe(2);
      expect(await count(class11)).toBe(2);
      expect(await count()).toBe(2);
    });

    it('a class-scoped event counts for its class only, not for another or for none', async () => {
      await holiday([class9]);
      expect(await count(class9)).toBe(2);
      expect(await count(class11)).toBe(3);
      expect(await count()).toBe(3);
    });

    it('a draft class-scoped event never counts', async () => {
      await holiday([class9], false);
      expect(await count(class9)).toBe(3);
    });

    it('isNonWorkingDay honours classId', async () => {
      await holiday([class9]);
      const day = { tenantId: TENANT_A, date: '2026-09-02' };
      expect(await service.isNonWorkingDay({ ...day, classId: class9 })).toBe(true);
      expect(await service.isNonWorkingDay({ ...day, classId: class11 })).toBe(false);
    });
  });

  // [68.3.15.01] TIME-05: a published MAKEUP_DAY adds a school day on a
  // weekly off-day.
  describe('MAKEUP_DAY', () => {
    // 2026-09-05 is a Saturday.
    const SATURDAY = '2026-09-05';
    let class9: string;
    let class11: string;

    beforeAll(async () => {
      const repo = dataSource.getRepository(Class);
      class9 = (
        await repo.save({
          name: 'Makeup 9',
          academic_year_id: academicYearAId,
          tenant_id: TENANT_A,
        })
      ).id;
      class11 = (
        await repo.save({
          name: 'Makeup 11',
          academic_year_id: academicYearAId,
          tenant_id: TENANT_A,
        })
      ).id;
    });

    async function makeup(
      opts: {
        tenantId?: string;
        yearId?: string;
        scopedTo?: string[];
        published?: boolean;
        date?: string;
      } = {},
    ): Promise<void> {
      const tenantId = opts.tenantId ?? TENANT_A;
      const event = await dataSource.getRepository(CalendarEvent).save({
        tenant_id: tenantId,
        academic_year_id: opts.yearId ?? academicYearAId,
        type: CalendarEventType.MAKEUP_DAY,
        start_date: opts.date ?? SATURDAY,
        end_date: opts.date ?? SATURDAY,
        name: 'Make-up Saturday',
        counts_as_working_day: true,
        published_at: opts.published === false ? null : new Date(),
      });
      for (const classId of opts.scopedTo ?? []) {
        await dataSource
          .getRepository(CalendarEventClass)
          .save({ event_id: event.id, class_id: classId, tenant_id: tenantId });
      }
    }
    const dates = (classId?: string) =>
      service
        .getWorkingDays({ tenantId: TENANT_A, from: '2026-09-04', to: '2026-09-06', classId })
        .then((r) => r.dates);

    beforeEach(async () => {
      // Friday + Saturday off.
      await setWeeklyOffDays(TENANT_A, [5, 6]);
    });

    it('a published MAKEUP_DAY on a weekly off-day is a working day', async () => {
      expect(await dates()).toEqual(['2026-09-06']);
      await makeup();
      expect(await dates()).toEqual([SATURDAY, '2026-09-06']);
      expect(await service.isNonWorkingDay({ tenantId: TENANT_A, date: SATURDAY })).toBe(false);
    });

    it('a class-scoped MAKEUP_DAY counts for its class only', async () => {
      await makeup({ scopedTo: [class9] });
      expect(await dates(class9)).toContain(SATURDAY);
      expect(await dates(class11)).not.toContain(SATURDAY);
      expect(await dates()).not.toContain(SATURDAY);
    });

    it('a draft MAKEUP_DAY never counts', async () => {
      await makeup({ published: false });
      expect(await dates()).not.toContain(SATURDAY);
    });

    it('a holiday on the same date still removes it', async () => {
      await makeup();
      await dataSource.getRepository(CalendarEvent).save({
        tenant_id: TENANT_A,
        academic_year_id: academicYearAId,
        start_date: SATURDAY,
        end_date: SATURDAY,
        name: 'Hartal',
        counts_as_working_day: false,
        published_at: new Date(),
      });
      expect(await dates()).not.toContain(SATURDAY);
    });

    it("tenant B's MAKEUP_DAY does not add a day for tenant A", async () => {
      await makeup({ tenantId: TENANT_B, yearId: academicYearBId });
      expect(await dates()).not.toContain(SATURDAY);
    });
  });
});
