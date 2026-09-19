import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource, getDataSourceToken } from '@nestjs/typeorm';
import { UnprocessableEntityException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { CalendarModule } from './calendar.module';
import { AuthModule } from '../auth/auth.module';
import { CalendarImportService } from './calendar-import.service';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarEventClass } from './entities/calendar-event-class.entity';
import { CalendarImportRowStatus, CalendarEventType, CalendarAudience } from '@biddaloy/shared';
import { toCsvContent } from '@biddaloy/shared';
import { CALENDAR_IMPORT_COLUMNS, RawCalendarImportRow } from './import/calendar-import-rows.util';

/**
 * Integration tests for `CalendarImportService` (17.3.1) — runs against the
 * real migrated test database. Uses a CSV buffer end-to-end (no `exceljs`
 * dependency in this spec) since `calendar-import-file.util.spec.ts`-level
 * concerns (xlsx cell parsing, header matching) already live with the file
 * util; this spec is about validate → stage → commit and the
 * NEW/UPDATED/UNCHANGED/ERROR reconciliation.
 */
describe('CalendarImportService (integration)', () => {
  let service: CalendarImportService;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  let yearId: string;
  let classId: string;

  function csvFile(rows: Partial<RawCalendarImportRow>[]): {
    buffer: Buffer;
    originalname: string;
  } {
    const full = (r: Partial<RawCalendarImportRow>): string[] =>
      CALENDAR_IMPORT_COLUMNS.map((c) => (r as RawCalendarImportRow)[c] ?? '');
    const content = toCsvContent([[...CALENDAR_IMPORT_COLUMNS], ...rows.map(full)]);
    return { buffer: Buffer.from(content, 'utf8'), originalname: 'import.csv' };
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), CalendarModule, AuthModule],
    );
    service = module.get<CalendarImportService>(CalendarImportService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const yearRepo = dataSource.getRepository(AcademicYear);
    const year = await yearRepo.save({
      name: 'Calendar Import Test Year',
      start_date: '2031-01-01',
      end_date: '2031-12-31',
      tenant_id: TENANT_ID,
    });
    yearId = year.id;

    const classRepo = dataSource.getRepository(Class);
    const klass = await classRepo.save({
      name: 'Import Test Class',
      academic_year_id: yearId,
      tenant_id: TENANT_ID,
    });
    classId = klass.id;
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('stages a NEW row for an event that does not exist yet', async () => {
    const result = await service.validate(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      csvFile([
        {
          type: 'EVENT',
          name: 'Sports Day 2031',
          start_date: '2031-03-01',
          end_date: '2031-03-01',
          counts_as_working_day: 'TRUE',
          audience: 'ALL',
        },
      ]),
    );

    expect(result.summary).toEqual({ new: 1, updated: 0, unchanged: 0, error: 0 });
    expect(result.rows[0].status).toBe(CalendarImportRowStatus.NEW);
  });

  it('reports a row-level error for an unknown class name', async () => {
    const result = await service.validate(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      csvFile([
        {
          type: 'EVENT',
          name: 'Bad Class Event',
          start_date: '2031-03-05',
          end_date: '2031-03-05',
          counts_as_working_day: 'TRUE',
          classes: 'Does Not Exist',
        },
      ]),
    );

    expect(result.summary.error).toBe(1);
    expect(result.rows[0].status).toBe(CalendarImportRowStatus.ERROR);
  });

  it('rejects a row whose end_date has already passed', async () => {
    const result = await service.validate(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      csvFile([
        {
          type: 'EVENT',
          name: 'Long Past Event',
          start_date: '2020-01-01',
          end_date: '2020-01-02',
          counts_as_working_day: 'TRUE',
        },
      ]),
    );

    expect(result.summary.error).toBe(1);
  });

  it('commit rejects when any staged row has an error (CALENDAR_IMPORT_HAS_ERRORS)', async () => {
    const result = await service.validate(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      csvFile([
        { type: 'BOGUS', name: 'Bad Type', start_date: '2031-03-10', end_date: '2031-03-10' },
      ]),
    );

    await expect(
      service.commit(TENANT_ID, SEED_ADMIN_USER_ID, result.staging_id, false),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ details: { code: 'CALENDAR_IMPORT_HAS_ERRORS' } }),
    });
  });

  it('commit is single-use: a second commit with the same staging_id fails', async () => {
    const result = await service.validate(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      csvFile([
        {
          type: 'EVENT',
          name: 'Single Use Event',
          start_date: '2031-04-01',
          end_date: '2031-04-01',
          counts_as_working_day: 'TRUE',
        },
      ]),
    );

    await service.commit(TENANT_ID, SEED_ADMIN_USER_ID, result.staging_id, false);

    await expect(
      service.commit(TENANT_ID, SEED_ADMIN_USER_ID, result.staging_id, false),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('commits a NEW row as a draft by default, resolves class names to ids', async () => {
    const validated = await service.validate(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      csvFile([
        {
          type: 'EXAM',
          name: 'Mid-term 2031',
          start_date: '2031-05-01',
          end_date: '2031-05-02',
          counts_as_working_day: 'TRUE',
          classes: 'Import Test Class',
        },
      ]),
    );

    const commitResult = await service.commit(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      validated.staging_id,
      false,
    );
    expect(commitResult).toEqual({ created: 1, updated: 0, unchanged: 0, failed: [] });

    const eventRepo = dataSource.getRepository(CalendarEvent);
    const saved = await eventRepo.findOneOrFail({
      where: { name: 'Mid-term 2031', tenant_id: TENANT_ID },
    });
    expect(saved.published_at).toBeNull();
    expect(saved.type).toBe(CalendarEventType.EXAM);

    const linkRepo = dataSource.getRepository(CalendarEventClass);
    const links = await linkRepo.find({ where: { event_id: saved.id } });
    expect(links.map((l: CalendarEventClass) => l.class_id)).toEqual([classId]);
  });

  it('re-importing an identical row after commit reconciles as UNCHANGED, not NEW', async () => {
    const first = await service.validate(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      csvFile([
        {
          type: 'HOLIDAY',
          name: 'Repeatable Holiday',
          start_date: '2031-06-01',
          end_date: '2031-06-01',
          counts_as_working_day: 'FALSE',
          audience: 'ALL',
        },
      ]),
    );
    await service.commit(TENANT_ID, SEED_ADMIN_USER_ID, first.staging_id, true);

    const second = await service.validate(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      csvFile([
        {
          type: 'HOLIDAY',
          name: 'Repeatable Holiday',
          start_date: '2031-06-01',
          end_date: '2031-06-01',
          counts_as_working_day: 'FALSE',
          audience: 'ALL',
        },
      ]),
    );

    expect(second.summary).toEqual({ new: 0, updated: 0, unchanged: 1, error: 0 });

    const commitResult = await service.commit(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      second.staging_id,
      false,
    );
    expect(commitResult).toEqual({ created: 0, updated: 0, unchanged: 1, failed: [] });
  });

  it('re-importing a changed row reconciles as UPDATED and applies the change', async () => {
    const first = await service.validate(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      csvFile([
        {
          type: 'MEETING',
          name: 'PTM 2031',
          start_date: '2031-07-01',
          end_date: '2031-07-01',
          counts_as_working_day: 'TRUE',
          audience: 'ALL',
        },
      ]),
    );
    await service.commit(TENANT_ID, SEED_ADMIN_USER_ID, first.staging_id, false);

    const second = await service.validate(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      csvFile([
        {
          type: 'MEETING',
          name: 'PTM 2031',
          start_date: '2031-07-01',
          end_date: '2031-07-01',
          counts_as_working_day: 'TRUE',
          audience: 'STAFF',
        },
      ]),
    );

    expect(second.summary).toEqual({ new: 0, updated: 1, unchanged: 0, error: 0 });
    await service.commit(TENANT_ID, SEED_ADMIN_USER_ID, second.staging_id, false);

    const eventRepo = dataSource.getRepository(CalendarEvent);
    const saved = await eventRepo.findOneOrFail({
      where: { name: 'PTM 2031', tenant_id: TENANT_ID },
    });
    expect(saved.audience).toBe(CalendarAudience.STAFF);
  });

  it('publishes an UPDATED row when committed with publish: true, even if the existing event was a draft', async () => {
    const first = await service.validate(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      csvFile([
        {
          type: 'MEETING',
          name: 'Staff Meeting 2031',
          start_date: '2031-08-01',
          end_date: '2031-08-01',
          counts_as_working_day: 'TRUE',
          audience: 'ALL',
        },
      ]),
    );
    // draft: publish=false
    await service.commit(TENANT_ID, SEED_ADMIN_USER_ID, first.staging_id, false);

    const second = await service.validate(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      csvFile([
        {
          type: 'MEETING',
          name: 'Staff Meeting 2031',
          start_date: '2031-08-01',
          end_date: '2031-08-01',
          counts_as_working_day: 'TRUE',
          audience: 'STAFF',
        },
      ]),
    );
    expect(second.summary).toEqual({ new: 0, updated: 1, unchanged: 0, error: 0 });

    // re-commit as UPDATED, this time with publish: true
    const commitResult = await service.commit(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      second.staging_id,
      true,
    );
    expect(commitResult).toEqual({ created: 0, updated: 1, unchanged: 0, failed: [] });

    const eventRepo = dataSource.getRepository(CalendarEvent);
    const saved = await eventRepo.findOneOrFail({
      where: { name: 'Staff Meeting 2031', tenant_id: TENANT_ID },
    });
    expect(saved.published_at).not.toBeNull();
  });
});
