import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource, getDataSourceToken } from '@nestjs/typeorm';
import { BadGatewayException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { CalendarEventType, PublicHolidaySource } from '@biddaloy/shared';
import { CalendarModule } from './calendar.module';
import { AuthModule } from '../auth/auth.module';
import { PublicHolidaysService } from './public-holidays.service';
import { PublicHolidayFetchService } from './public-holiday-fetch.service';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { CalendarEvent } from './entities/calendar-event.entity';
import { PublicHolidaySet } from './entities/public-holiday-set.entity';
import { PublicHolidayEntry } from './entities/public-holiday-entry.entity';

/**
 * Integration tests for `PublicHolidaysService` (17.2.4) — real, migrated
 * test database. `PublicHolidayFetchService.fetch` is mocked throughout:
 * this service's own reach-the-network behaviour is covered by
 * `public-holiday-fetch.service.spec.ts`; here we only need it to return a
 * fixed set so `fetchIntoSet`/`suggest`/`bulkAdd` can be exercised.
 */
describe('PublicHolidaysService (integration)', () => {
  let service: PublicHolidaysService;
  let fetchService: PublicHolidayFetchService;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), CalendarModule, AuthModule],
    );
    service = module.get<PublicHolidaysService>(PublicHolidaysService);
    fetchService = module.get<PublicHolidayFetchService>(PublicHolidayFetchService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const yearRepo = dataSource.getRepository(AcademicYear);
    const existing = await yearRepo.findOne({
      where: { tenant_id: TENANT_ID, name: 'Public Holidays Test Year' },
    });
    if (!existing) {
      await yearRepo.save({
        name: 'Public Holidays Test Year',
        start_date: '2030-01-01',
        end_date: '2030-12-31',
        tenant_id: TENANT_ID,
      });
    }
  });

  beforeEach(async () => {
    await dataSource.getRepository(CalendarEvent).delete({ tenant_id: TENANT_ID });
    await dataSource.createQueryBuilder().delete().from(PublicHolidayEntry).execute();
    await dataSource.createQueryBuilder().delete().from(PublicHolidaySet).execute();
    vi.restoreAllMocks();
  });

  function mockFetch(entries: { date: string; end_date: string; name: string }[]) {
    vi.spyOn(fetchService, 'fetch').mockResolvedValue({
      source: PublicHolidaySource.GOOGLE_ICS,
      entries,
    });
  }

  it('fetchIntoSet creates a new set with entries, unpublished', async () => {
    mockFetch([{ date: '2030-01-01', end_date: '2030-01-01', name: 'New Year' }]);

    const set = await service.fetchIntoSet('BD', 2030, SEED_ADMIN_USER_ID);

    expect(set.country).toBe('BD');
    expect(set.year).toBe(2030);
    expect(set.published_at).toBeNull();
    expect(set.entries).toHaveLength(1);
    expect(set.entries[0].name).toBe('New Year');
  });

  it('re-fetching an already-published set replaces entries but keeps published_at', async () => {
    mockFetch([{ date: '2030-01-01', end_date: '2030-01-01', name: 'New Year' }]);
    const first = await service.fetchIntoSet('BD', 2030, SEED_ADMIN_USER_ID);
    await service.publish(first.id, SEED_ADMIN_USER_ID);

    mockFetch([{ date: '2030-03-26', end_date: '2030-03-26', name: 'Independence Day' }]);
    const refetched = await service.fetchIntoSet('BD', 2030, SEED_ADMIN_USER_ID);

    expect(refetched.id).toBe(first.id);
    expect(refetched.published_at).not.toBeNull();
    expect(refetched.entries).toHaveLength(1);
    expect(refetched.entries[0].name).toBe('Independence Day');
  });

  it('fetchIntoSet raises a 502 with PUBLIC_HOLIDAY_SOURCE_UNAVAILABLE when the source fails', async () => {
    vi.spyOn(fetchService, 'fetch').mockRejectedValue(
      new (await import('./public-holiday-fetch.service')).PublicHolidaySourceUnavailableError(
        'BD',
        2030,
      ),
    );

    await expect(service.fetchIntoSet('BD', 2030, SEED_ADMIN_USER_ID)).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('updateEntries fully replaces entries, including name_bn', async () => {
    mockFetch([{ date: '2030-01-01', end_date: '2030-01-01', name: 'New Year' }]);
    const set = await service.fetchIntoSet('BD', 2030, SEED_ADMIN_USER_ID);

    const updated = await service.updateEntries(
      set.id,
      [{ date: '2030-01-01', end_date: '2030-01-01', name: 'New Year', name_bn: 'নববর্ষ' }],
      SEED_ADMIN_USER_ID,
    );

    expect(updated.entries).toHaveLength(1);
    expect(updated.entries[0].name_bn).toBe('নববর্ষ');
  });

  it('publish/unpublish toggle published_at', async () => {
    mockFetch([{ date: '2030-01-01', end_date: '2030-01-01', name: 'New Year' }]);
    const set = await service.fetchIntoSet('BD', 2030, SEED_ADMIN_USER_ID);

    const published = await service.publish(set.id, SEED_ADMIN_USER_ID);
    expect(published.published_at).not.toBeNull();

    const unpublished = await service.unpublish(set.id, SEED_ADMIN_USER_ID);
    expect(unpublished.published_at).toBeNull();
  });

  it('suggest returns [] when no set has been published for the tenant country/year', async () => {
    const suggestions = await service.suggest(TENANT_ID, 2030);
    expect(suggestions).toEqual([]);
  });

  it('suggest returns published entries annotated already_added', async () => {
    mockFetch([
      { date: '2030-01-01', end_date: '2030-01-01', name: 'New Year' },
      { date: '2030-03-26', end_date: '2030-03-26', name: 'Independence Day' },
    ]);
    const set = await service.fetchIntoSet('BD', 2030, SEED_ADMIN_USER_ID);
    await service.publish(set.id, SEED_ADMIN_USER_ID);

    await dataSource.getRepository(CalendarEvent).save({
      tenant_id: TENANT_ID,
      academic_year_id: (
        await dataSource
          .getRepository(AcademicYear)
          .findOneOrFail({ where: { tenant_id: TENANT_ID, name: 'Public Holidays Test Year' } })
      ).id,
      type: CalendarEventType.HOLIDAY,
      name: 'New Year (already on calendar)',
      start_date: '2030-01-01',
      end_date: '2030-01-01',
      counts_as_working_day: false,
      published_at: new Date(),
    });

    const suggestions = await service.suggest(TENANT_ID, 2030);
    const byDate = Object.fromEntries(suggestions.map((s) => [s.date, s.already_added]));
    expect(byDate['2030-01-01']).toBe(true);
    expect(byDate['2030-03-26']).toBe(false);
  });

  it('bulkAdd creates HOLIDAY events for requested entries and skips already-added dates', async () => {
    mockFetch([
      { date: '2030-01-01', end_date: '2030-01-01', name: 'New Year' },
      { date: '2030-03-26', end_date: '2030-03-26', name: 'Independence Day' },
    ]);
    const set = await service.fetchIntoSet('BD', 2030, SEED_ADMIN_USER_ID);
    await service.publish(set.id, SEED_ADMIN_USER_ID);

    const entryIds = set.entries.map((e) => e.id);
    const result = await service.bulkAdd(TENANT_ID, SEED_ADMIN_USER_ID, entryIds);
    expect(result.added).toBe(2);

    const events = await dataSource
      .getRepository(CalendarEvent)
      .find({ where: { tenant_id: TENANT_ID, type: CalendarEventType.HOLIDAY } });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.published_at !== null)).toBe(true);

    // A second bulkAdd for the same entries adds nothing new.
    const secondResult = await service.bulkAdd(TENANT_ID, SEED_ADMIN_USER_ID, entryIds);
    expect(secondResult.added).toBe(0);
  });
});
