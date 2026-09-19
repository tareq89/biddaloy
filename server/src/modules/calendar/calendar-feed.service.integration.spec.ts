import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource, getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { CalendarAudience, CalendarEventType, UserRole, UserStatus } from '@biddaloy/shared';
import { CalendarModule } from './calendar.module';
import { AuthModule } from '../auth/auth.module';
import { CalendarFeedService } from './calendar-feed.service';
import { CalendarEventsService } from './calendar-events.service';
import { CalendarFeedToken } from './entities/calendar-feed-token.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcademicTerm } from './entities/academic-term.entity';
import { CalendarEvent } from './entities/calendar-event.entity';
import { User } from '../users/entities/user.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';

/**
 * Integration tests for `CalendarFeedService` (17.4.1) — real, migrated
 * test database. Uses the seeded ADMIN (`SEED_ADMIN_USER_ID`), who is
 * unrestricted per `calendar-visibility.util.ts`, so these tests focus on
 * token lifecycle and rendering rather than re-testing visibility rules
 * already covered by `calendar-visibility.util.spec.ts` and
 * `calendar-events.service.integration.spec.ts`.
 */
describe('CalendarFeedService (integration)', () => {
  let service: CalendarFeedService;
  let eventsService: CalendarEventsService;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  let yearId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';

    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), CalendarModule, AuthModule],
    );
    service = module.get<CalendarFeedService>(CalendarFeedService);
    eventsService = module.get<CalendarEventsService>(CalendarEventsService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    // Spans "today" with a wide margin regardless of when this suite runs,
    // so the feed's [today-90d, today+400d] window always falls inside it.
    const yearRepo = dataSource.getRepository(AcademicYear);
    const year = await yearRepo.save({
      name: 'Calendar Feed Test Year',
      start_date: '2000-01-01',
      end_date: '2100-12-31',
      tenant_id: TENANT_ID,
    });
    yearId = year.id;
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  function today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  describe('getOrCreate / regenerate', () => {
    it('mints a token on first call and returns the same URL on repeat calls', async () => {
      const first = await service.getOrCreate(TENANT_ID, SEED_ADMIN_USER_ID);
      expect(first.url).toMatch(/\/api\/v1\/calendar\/feed\/.+\.ics$/);

      const second = await service.getOrCreate(TENANT_ID, SEED_ADMIN_USER_ID);
      expect(second.url).toBe(first.url);
      expect(second.created_at).toBe(first.created_at);
    });

    it('regenerate revokes the old token and the old URL 404s afterward', async () => {
      const before = await service.getOrCreate(TENANT_ID, SEED_ADMIN_USER_ID);
      const oldToken = before.url
        .split('/')
        .pop()!
        .replace(/\.ics$/, '');

      const after = await service.regenerate(TENANT_ID, SEED_ADMIN_USER_ID);
      expect(after.url).not.toBe(before.url);

      await expect(service.render(oldToken)).rejects.toThrow(NotFoundException);

      const newToken = after.url
        .split('/')
        .pop()!
        .replace(/\.ics$/, '');
      await expect(service.render(newToken)).resolves.toBeDefined();
    });

    it('only one active token per (tenant, user) survives regeneration', async () => {
      await service.regenerate(TENANT_ID, SEED_ADMIN_USER_ID);
      const tokenRepo = dataSource.getRepository(CalendarFeedToken);
      const active = await tokenRepo.find({
        where: { tenant_id: TENANT_ID, user_id: SEED_ADMIN_USER_ID, revoked_at: null as any },
      });
      expect(active.length).toBe(1);
    });
  });

  describe('render', () => {
    it('404s for an unknown token', async () => {
      await expect(service.render('not-a-real-token')).rejects.toThrow(NotFoundException);
    });

    it('renders published events within the feed window as VEVENTs', async () => {
      const { url } = await service.regenerate(TENANT_ID, SEED_ADMIN_USER_ID);
      const rawToken = url
        .split('/')
        .pop()!
        .replace(/\.ics$/, '');

      await eventsService.create(
        {
          type: CalendarEventType.EVENT,
          name: 'Feed Test Event',
          start_date: today(),
          end_date: today(),
          audience: CalendarAudience.ALL,
          publish: true,
        } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const { body, etag } = await service.render(rawToken);
      expect(body).toContain('BEGIN:VCALENDAR');
      expect(body).toContain('SUMMARY:Feed Test Event');
      expect(etag).toMatch(/^".+"$/);
    });

    it('excludes unpublished (draft) events', async () => {
      const { url } = await service.getOrCreate(TENANT_ID, SEED_ADMIN_USER_ID);
      const rawToken = url
        .split('/')
        .pop()!
        .replace(/\.ics$/, '');

      await eventsService.create(
        {
          type: CalendarEventType.EVENT,
          name: 'Draft Feed Event',
          start_date: today(),
          end_date: today(),
          audience: CalendarAudience.ALL,
          publish: false,
        } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const { body } = await service.render(rawToken);
      expect(body).not.toContain('Draft Feed Event');
    });

    it('excludes events outside the [-90d, +400d] window', async () => {
      const { url } = await service.getOrCreate(TENANT_ID, SEED_ADMIN_USER_ID);
      const rawToken = url
        .split('/')
        .pop()!
        .replace(/\.ics$/, '');

      const eventRepo = dataSource.getRepository(CalendarEvent);
      await eventRepo.save(
        eventRepo.create({
          tenant_id: TENANT_ID,
          academic_year_id: yearId,
          type: CalendarEventType.EVENT,
          name: 'Far Future Event',
          start_date: '2099-01-01',
          end_date: '2099-01-01',
          audience: CalendarAudience.ALL,
          published_at: new Date(),
        }),
      );

      const { body } = await service.render(rawToken);
      expect(body).not.toContain('Far Future Event');
    });

    it('same-day ETag is stable across renders when nothing changed', async () => {
      const { url } = await service.getOrCreate(TENANT_ID, SEED_ADMIN_USER_ID);
      const rawToken = url
        .split('/')
        .pop()!
        .replace(/\.ics$/, '');

      const first = await service.render(rawToken);
      const second = await service.render(rawToken);
      expect(second.etag).toBe(first.etag);
    });

    it('404s once the token owner is deactivated', async () => {
      const { url } = await service.regenerate(TENANT_ID, SEED_ADMIN_USER_ID);
      const rawToken = url
        .split('/')
        .pop()!
        .replace(/\.ics$/, '');

      const userRepo = dataSource.getRepository(User);
      await userRepo.update(SEED_ADMIN_USER_ID, { status: UserStatus.SUSPENDED });
      try {
        await expect(service.render(rawToken)).rejects.toThrow(NotFoundException);
      } finally {
        // Restore the seeded user's baseline status for any later test in
        // this file/suite that relies on it.
        await userRepo.update(SEED_ADMIN_USER_ID, { status: UserStatus.ACTIVE });
      }
    });
  });
});
