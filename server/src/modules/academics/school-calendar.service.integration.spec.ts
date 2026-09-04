import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { AcademicYearModule } from './academic-year.module';
import { SchoolCalendarService } from './school-calendar.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from './entities/academic-year.entity';
import { SchoolHoliday } from './entities/school-holiday.entity';

/**
 * Integration tests for `SchoolCalendarService`'s working-day math — the
 * one place `AttendanceService` ([9.3]) and `AttendanceSummaryService`
 * ([9.4]) both read "is this a school day". Runs against a real, migrated
 * test database.
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

  const TENANT_A = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000099';
  let academicYearAId: string;
  let academicYearBId: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), AcademicYearModule],
    );
    service = module.get<SchoolCalendarService>(SchoolCalendarService);
    dataSource = module.get<DataSource>(getDataSourceToken());

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
    // school_holidays is a "transactional" table for this suite's purposes
    // — reseed per test rather than relying on file-level fixtures.
    await dataSource.query('DELETE FROM school_holidays');
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

    it('excludes a multi-day holiday', async () => {
      await dataSource.getRepository(SchoolHoliday).save({
        tenant_id: TENANT_A,
        academic_year_id: academicYearAId,
        start_date: '2026-09-02',
        end_date: '2026-09-03',
        name: 'Eid Break',
        counts_as_working_day: false,
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
      await dataSource.getRepository(SchoolHoliday).save({
        tenant_id: TENANT_A,
        academic_year_id: academicYearAId,
        start_date: '2026-09-02',
        end_date: '2026-09-02',
        name: 'Half-Yearly Exam',
        counts_as_working_day: true,
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
      const holidayRepo = dataSource.getRepository(SchoolHoliday);
      await holidayRepo.save({
        tenant_id: TENANT_A,
        academic_year_id: academicYearAId,
        start_date: '2026-09-02',
        end_date: '2026-09-04',
        name: 'Holiday A',
        counts_as_working_day: false,
      });
      await holidayRepo.save({
        tenant_id: TENANT_A,
        academic_year_id: academicYearAId,
        start_date: '2026-09-03',
        end_date: '2026-09-05',
        name: 'Holiday B',
        counts_as_working_day: false,
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
      await dataSource.getRepository(SchoolHoliday).save({
        tenant_id: TENANT_B,
        academic_year_id: academicYearBId,
        start_date: '2026-09-02',
        end_date: '2026-09-02',
        name: 'Tenant B Holiday',
        counts_as_working_day: false,
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

  describe('holiday CRUD', () => {
    it('creates, lists, updates, and soft-deletes a holiday scoped to the tenant', async () => {
      const created = await service.createHoliday(
        {
          academic_year_id: academicYearAId,
          start_date: '2026-10-01',
          end_date: '2026-10-01',
          name: 'Founders Day',
        },
        TENANT_A,
        SEED_ADMIN_USER_ID,
      );
      expect(created.counts_as_working_day).toBe(false);

      const listed = await service.listHolidays({ page: 1, limit: 10 } as any, TENANT_A);
      expect(listed.data.some((h) => h.id === created.id)).toBe(true);

      const updated = await service.updateHoliday(
        created.id,
        { name: 'Founders Day (renamed)' },
        TENANT_A,
        SEED_ADMIN_USER_ID,
      );
      expect(updated.name).toBe('Founders Day (renamed)');

      await service.removeHoliday(created.id, TENANT_A, SEED_ADMIN_USER_ID);
      const afterDelete = await service.listHolidays({ page: 1, limit: 10 } as any, TENANT_A);
      expect(afterDelete.data.some((h) => h.id === created.id)).toBe(false);
    });

    it("does not let tenant B read or mutate tenant A's holiday", async () => {
      const created = await service.createHoliday(
        {
          academic_year_id: academicYearAId,
          start_date: '2026-10-02',
          end_date: '2026-10-02',
          name: 'Tenant A Only',
        },
        TENANT_A,
        SEED_ADMIN_USER_ID,
      );

      const listedByB = await service.listHolidays({ page: 1, limit: 10 } as any, TENANT_B);
      expect(listedByB.data.some((h) => h.id === created.id)).toBe(false);

      await expect(
        service.updateHoliday(created.id, { name: 'Hijacked' }, TENANT_B, SEED_ADMIN_USER_ID),
      ).rejects.toThrow();
    });
  });
});
