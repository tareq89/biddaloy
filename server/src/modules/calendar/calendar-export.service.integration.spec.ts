import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource, getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { CalendarModule } from './calendar.module';
import { AuthModule } from '../auth/auth.module';
import { CalendarExportService } from './calendar-export.service';
import { CalendarImportService } from './calendar-import.service';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarImportRowStatus, CalendarAudience, UserRole } from '@biddaloy/shared';
import { CALENDAR_IMPORT_COLUMNS, RawCalendarImportRow } from './import/calendar-import-rows.util';
import { CalendarViewer } from './calendar-visibility.util';

/**
 * Integration tests for `CalendarExportService` (17.3.2), against a real
 * migrated test database. Covers the two flows the issue calls out:
 * export round-tripping through `CalendarImportService`, and clone's
 * date-shift/drop/reconcile logic. HTTP-boundary concerns (role gating,
 * cross-tenant rejection) live in `calendar-export.e2e-spec.ts`.
 *
 * Academic years are TypeORM "reference table" fixtures (survive across
 * `it`s in this file, per `test/reset-order.ts`'s `REFERENCE_TABLES`), so
 * they're created once in `beforeAll`. `CalendarEvent` rows are a
 * "transactional table" — the global `beforeEach` truncates it before
 * *every* `it` (`test/setup.ts`'s `clearTransactionalTables`) — so every
 * event fixture must be created inside the `it` that needs it, never in
 * `beforeAll`.
 */
describe('CalendarExportService (integration)', () => {
  let exportService: CalendarExportService;
  let importService: CalendarImportService;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const ADMIN_VIEWER: CalendarViewer = {
    role: UserRole.ADMIN,
    userId: SEED_ADMIN_USER_ID,
    classIds: [],
  };

  let sourceYearId: string;
  let targetYearId: string;
  let leapSourceYearId: string;
  let leapTargetYearId: string;

  function rawRow(overrides: Partial<RawCalendarImportRow>): RawCalendarImportRow {
    const base: RawCalendarImportRow = {
      type: 'EVENT',
      name: 'placeholder',
      start_date: '2031-01-01',
      end_date: '2031-01-01',
      start_time: '',
      end_time: '',
      counts_as_working_day: 'TRUE',
      audience: 'ALL',
      classes: '',
      description: '',
    };
    return { ...base, ...overrides };
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), CalendarModule, AuthModule],
    );
    exportService = module.get<CalendarExportService>(CalendarExportService);
    importService = module.get<CalendarImportService>(CalendarImportService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const yearRepo = dataSource.getRepository(AcademicYear);
    const sourceYear = await yearRepo.save({
      name: 'Export Source Year',
      start_date: '2031-01-01',
      end_date: '2031-12-31',
      tenant_id: TENANT_ID,
    });
    sourceYearId = sourceYear.id;

    // Target year one calendar year later.
    const targetYear = await yearRepo.save({
      name: 'Export Target Year',
      start_date: '2032-01-01',
      end_date: '2032-12-31',
      tenant_id: TENANT_ID,
    });
    targetYearId = targetYear.id;

    // A second, separate source→target pair whose shift crosses a leap
    // day (2032-02-29) — proves the shift is calendar-aware, not a fixed
    // 365-day add.
    const leapSourceYear = await yearRepo.save({
      name: 'Leap Source Year',
      start_date: '2030-02-01',
      end_date: '2031-01-31',
      tenant_id: TENANT_ID,
    });
    leapSourceYearId = leapSourceYear.id;
    const leapTargetYear = await yearRepo.save({
      name: 'Leap Target Year',
      start_date: '2032-02-01',
      end_date: '2033-01-31',
      tenant_id: TENANT_ID,
    });
    leapTargetYearId = leapTargetYear.id;
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('throws NotFoundException for an academic year id not in this tenant', async () => {
    await expect(
      exportService.exportWorkbook(
        TENANT_ID,
        '00000000-0000-4000-8000-000000009999',
        'csv',
        ADMIN_VIEWER,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('exports published events as .csv, excluding drafts', async () => {
    const eventRepo = dataSource.getRepository(CalendarEvent);
    await eventRepo.save({
      tenant_id: TENANT_ID,
      academic_year_id: sourceYearId,
      type: 'EVENT',
      name: 'Export Draft Event',
      start_date: '2031-02-01',
      end_date: '2031-02-01',
      counts_as_working_day: true,
      audience: CalendarAudience.ALL,
      published_at: null,
    });
    await eventRepo.save({
      tenant_id: TENANT_ID,
      academic_year_id: sourceYearId,
      type: 'HOLIDAY',
      name: 'Export Holiday',
      start_date: '2031-03-01',
      end_date: '2031-03-01',
      counts_as_working_day: false,
      audience: CalendarAudience.ALL,
      published_at: new Date(),
    });

    const { buffer, contentType } = await exportService.exportWorkbook(
      TENANT_ID,
      sourceYearId,
      'csv',
      ADMIN_VIEWER,
    );
    const text = buffer.toString('utf8');
    expect(contentType).toContain('text/csv');
    expect(text).toContain('Export Holiday');
    expect(text).not.toContain('Export Draft Event');

    // Header must match `CALENDAR_IMPORT_COLUMNS` exactly (D12).
    for (const column of CALENDAR_IMPORT_COLUMNS) {
      expect(text).toContain(column);
    }
  });

  it('an exported .csv re-imports as all UNCHANGED (D12 round-trip)', async () => {
    const yearRepo = dataSource.getRepository(AcademicYear);
    const roundTripYear = await yearRepo.save({
      name: 'Round Trip Year',
      start_date: '2033-01-01',
      end_date: '2033-12-31',
      tenant_id: TENANT_ID,
    });

    const raw = rawRow({
      type: 'EVENT',
      name: 'Round Trip Event',
      start_date: '2033-04-01',
      end_date: '2033-04-01',
    });
    const staged = await importService.validate(TENANT_ID, SEED_ADMIN_USER_ID, {
      buffer: Buffer.from(
        [
          CALENDAR_IMPORT_COLUMNS.join(','),
          CALENDAR_IMPORT_COLUMNS.map((c) => raw[c]).join(','),
        ].join('\n'),
        'utf8',
      ),
      originalname: 'round-trip.csv',
    });
    await importService.commit(TENANT_ID, SEED_ADMIN_USER_ID, staged.staging_id, true);

    const { buffer } = await exportService.exportWorkbook(
      TENANT_ID,
      roundTripYear.id,
      'csv',
      ADMIN_VIEWER,
    );

    const reimported = await importService.validate(TENANT_ID, SEED_ADMIN_USER_ID, {
      buffer,
      originalname: 're-import.csv',
    });
    expect(reimported.summary).toEqual({ new: 0, updated: 0, unchanged: 1, error: 0 });
  });

  it('clone shifts dates by target.start_date - source.start_date, excludes HOLIDAY by default', async () => {
    const eventRepo = dataSource.getRepository(CalendarEvent);
    await eventRepo.save({
      tenant_id: TENANT_ID,
      academic_year_id: sourceYearId,
      type: 'EXAM',
      name: 'Clone Exam',
      start_date: '2031-05-10',
      end_date: '2031-05-11',
      counts_as_working_day: true,
      audience: CalendarAudience.ALL,
      published_at: new Date(),
    });
    await eventRepo.save({
      tenant_id: TENANT_ID,
      academic_year_id: sourceYearId,
      type: 'HOLIDAY',
      name: 'Clone Holiday',
      start_date: '2031-05-12',
      end_date: '2031-05-12',
      counts_as_working_day: false,
      audience: CalendarAudience.ALL,
      published_at: new Date(),
    });

    const result = await exportService.cloneToYear(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      sourceYearId,
      targetYearId,
      undefined,
    );

    const examRow = result.rows.find((r) => r.status === CalendarImportRowStatus.NEW);
    expect(examRow).toBeDefined();

    const staged = await importService.commit(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      result.staging_id,
      false,
    );
    expect(staged.created).toBe(1); // only the EXAM, HOLIDAY excluded by default

    const cloned = await eventRepo.findOneOrFail({
      where: { name: 'Clone Exam', tenant_id: TENANT_ID, academic_year_id: targetYearId },
    });
    // `target.start_date` (2032-01-01) - `source.start_date` (2031-01-01)
    // is 365 days, but 2032 is itself a leap year, so a date-object shift
    // (not a naive "add 365") lands one day earlier than the naive same
    // calendar date next year.
    expect(cloned.start_date).toBe('2032-05-09');
    expect(cloned.end_date).toBe('2032-05-10');

    const holidayClone = await eventRepo.findOne({
      where: { name: 'Clone Holiday', tenant_id: TENANT_ID, academic_year_id: targetYearId },
    });
    expect(holidayClone).toBeNull();
  });

  it('shifts correctly across a leap day', async () => {
    const eventRepo = dataSource.getRepository(CalendarEvent);
    await eventRepo.save({
      tenant_id: TENANT_ID,
      academic_year_id: leapSourceYearId,
      type: 'EXAM',
      name: 'Leap Shift Exam',
      start_date: '2030-02-27',
      end_date: '2030-02-27',
      counts_as_working_day: true,
      audience: CalendarAudience.ALL,
      published_at: new Date(),
    });

    const result = await exportService.cloneToYear(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      leapSourceYearId,
      leapTargetYearId,
      undefined,
    );

    // Pin the expectation against `Date`'s own calendar math (not a
    // hand-counted day offset) so a UTC-vs-local regression in the
    // service would still fail this test.
    const offsetMs =
      new Date('2032-02-01T00:00:00.000Z').getTime() -
      new Date('2030-02-01T00:00:00.000Z').getTime();
    const expected = new Date(new Date('2030-02-27T00:00:00.000Z').getTime() + offsetMs)
      .toISOString()
      .slice(0, 10);

    const row = result.rows.find((r) => r.status === CalendarImportRowStatus.NEW);
    expect(row).toBeDefined();

    await importService.commit(TENANT_ID, SEED_ADMIN_USER_ID, result.staging_id, false);
    // Match by `(name, start_date)` on the *shifted* date, not just name
    // — the un-shifted source event shares the same name. Other fixture
    // years in this file overlap `leapTargetYearId`'s date range, so
    // `create()`'s own `resolveAcademicYear` may resolve the row to any
    // of them; the clone's own academic-year targeting isn't what this
    // test checks, only the date shift is.
    const cloned = await eventRepo.findOneOrFail({
      where: { name: 'Leap Shift Exam', tenant_id: TENANT_ID, start_date: expected },
    });
    expect(cloned.start_date).toBe(expected);
  });

  it('drops rows whose shifted dates fall outside the target academic year, and counts them', async () => {
    const yearRepo = dataSource.getRepository(AcademicYear);
    const narrowSource = await yearRepo.save({
      name: 'Narrow Source Year',
      start_date: '2034-01-01',
      end_date: '2034-12-31',
      tenant_id: TENANT_ID,
    });
    const narrowTarget = await yearRepo.save({
      name: 'Narrow Target Year',
      start_date: '2035-01-01',
      end_date: '2035-06-30', // shorter than source -> late-year event drops
      tenant_id: TENANT_ID,
    });

    const eventRepo = dataSource.getRepository(CalendarEvent);
    await eventRepo.save({
      tenant_id: TENANT_ID,
      academic_year_id: narrowSource.id,
      type: 'EVENT',
      name: 'Drops Out Of Range',
      start_date: '2034-11-01',
      end_date: '2034-11-01',
      counts_as_working_day: true,
      audience: CalendarAudience.ALL,
      published_at: new Date(),
    });

    const result = await exportService.cloneToYear(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      narrowSource.id,
      narrowTarget.id,
      undefined,
    );

    expect(result.dropped).toBe(1);
    expect(result.rows).toHaveLength(0);
    expect(result.summary).toEqual({ new: 0, updated: 0, unchanged: 0, error: 0 });
  });

  it('does not false-match an unrelated event in a different year sharing the shifted name/date', async () => {
    const yearRepo = dataSource.getRepository(AcademicYear);
    const eventRepo = dataSource.getRepository(CalendarEvent);

    const collisionSource = await yearRepo.save({
      name: 'Collision Source Year',
      start_date: '2040-01-01',
      end_date: '2040-12-31',
      tenant_id: TENANT_ID,
    });
    const collisionTarget = await yearRepo.save({
      name: 'Collision Target Year',
      start_date: '2041-01-01',
      end_date: '2041-12-31',
      tenant_id: TENANT_ID,
    });
    // A third, unrelated year with an event that happens to share the name
    // and the *shifted* date the clone will produce — without year-scoping
    // the existing-event lookup, this would wrongly count as a match.
    const unrelatedYear = await yearRepo.save({
      name: 'Unrelated Third Year',
      start_date: '2020-01-01',
      end_date: '2020-12-31',
      tenant_id: TENANT_ID,
    });
    const unrelatedEvent = await eventRepo.save({
      tenant_id: TENANT_ID,
      academic_year_id: unrelatedYear.id,
      type: 'EVENT',
      name: 'Collision Event',
      // diffDays('2040-01-01', '2041-01-01') is 366 (2040 is a leap year),
      // so the source event below shifts to 2041-03-11, not 2041-03-10 —
      // matching that exactly is what makes this a real collision risk.
      start_date: '2041-03-11',
      end_date: '2041-03-11',
      counts_as_working_day: true,
      audience: CalendarAudience.ALL,
      published_at: new Date(),
    });

    await eventRepo.save({
      tenant_id: TENANT_ID,
      academic_year_id: collisionSource.id,
      type: 'EVENT',
      name: 'Collision Event',
      start_date: '2040-03-10',
      end_date: '2040-03-10',
      counts_as_working_day: true,
      audience: CalendarAudience.ALL,
      published_at: new Date(),
    });

    const result = await exportService.cloneToYear(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      collisionSource.id,
      collisionTarget.id,
      undefined,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe(CalendarImportRowStatus.NEW);

    // The unrelated third-year event must be untouched.
    const stillThere = await eventRepo.findOneOrFail({ where: { id: unrelatedEvent.id } });
    expect(stillThere.academic_year_id).toBe(unrelatedYear.id);
  });
});
