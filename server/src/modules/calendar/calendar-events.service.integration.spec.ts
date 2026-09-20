import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource, getDataSourceToken } from '@nestjs/typeorm';
import { UnprocessableEntityException } from '@nestjs/common';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { CalendarModule } from './calendar.module';
import { AuthModule } from '../auth/auth.module';
import { CalendarEventsService } from './calendar-events.service';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { School } from '../schools/entities/school.entity';
import { AttendanceSession } from '../attendance/entities/attendance-session.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import {
  AttendanceSessionState,
  CalendarAudience,
  CalendarEventType,
  UserRole,
} from '@biddaloy/shared';

/**
 * Integration tests for `CalendarEventsService` — runs against the real,
 * migrated test database. Dates below are all far enough from "today" that
 * they stay stable regardless of what day the suite runs.
 */
describe('CalendarEventsService (integration)', () => {
  let service: CalendarEventsService;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';
  const ADMIN_VIEWER = { role: UserRole.ADMIN, userId: SEED_ADMIN_USER_ID, classIds: [] };

  let yearId: string;
  /** Spans real "today", so a date within it can genuinely be in the past
   * or be "today" — `yearId` above spans only 2030, which is always in
   * the future relative to whatever day this suite runs on. */
  let pastSpanningYearId: string;
  let classId: string;
  let otherTenantClassId: string;
  let sectionId: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), CalendarModule, AuthModule],
    );
    service = module.get<CalendarEventsService>(CalendarEventsService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    await schoolRepo.save({
      id: OTHER_TENANT_ID,
      name: 'Other School',
      slug: 'calendar-events-other-school',
    });

    const yearRepo = dataSource.getRepository(AcademicYear);
    const year = await yearRepo.save({
      name: 'Calendar Events Test Year',
      start_date: '2030-01-01',
      end_date: '2030-12-31',
      tenant_id: TENANT_ID,
    });
    yearId = year.id;

    const classRepo = dataSource.getRepository(Class);
    const klass = await classRepo.save({
      name: 'Calendar Events Test Class',
      academic_year_id: yearId,
      tenant_id: TENANT_ID,
    });
    classId = klass.id;

    const pastSpanningYear = await yearRepo.save({
      name: 'Calendar Events Past-Spanning Year',
      start_date: '2020-01-01',
      end_date: '2027-12-31',
      tenant_id: TENANT_ID,
    });
    pastSpanningYearId = pastSpanningYear.id;

    const otherYear = await yearRepo.save({
      name: 'Other Tenant Year',
      start_date: '2030-01-01',
      end_date: '2030-12-31',
      tenant_id: OTHER_TENANT_ID,
    });
    const otherClass = await classRepo.save({
      name: 'Other Tenant Class',
      academic_year_id: otherYear.id,
      tenant_id: OTHER_TENANT_ID,
    });
    otherTenantClassId = otherClass.id;

    const sectionRepo = dataSource.getRepository(ClassSection);
    const section = await sectionRepo.save({
      class_id: classId,
      tenant_id: TENANT_ID,
      section_name: 'A',
    });
    sectionId = section.id;
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('creates an event and derives its academic year from start_date', async () => {
    const created = await service.create(
      {
        type: CalendarEventType.EVENT,
        name: 'Sports Day',
        start_date: '2030-03-01',
        end_date: '2030-03-01',
        audience: CalendarAudience.ALL,
        publish: true,
      } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );

    expect(created.academic_year_id).toBe(yearId);
    expect(created.published).toBe(true);
  });

  it('rejects a range that crosses an academic-year boundary', async () => {
    await expect(
      service.create(
        {
          type: CalendarEventType.EVENT,
          name: 'Crosses boundary',
          start_date: '2030-12-30',
          end_date: '2031-01-02',
          audience: CalendarAudience.ALL,
        } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a class_id that belongs to another tenant', async () => {
    await expect(
      service.create(
        {
          type: CalendarEventType.EVENT,
          name: 'Other tenant class',
          start_date: '2030-04-01',
          end_date: '2030-04-01',
          audience: CalendarAudience.ALL,
          class_ids: [otherTenantClassId],
        } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('stores class_ids for a valid same-tenant class', async () => {
    const created = await service.create(
      {
        type: CalendarEventType.EVENT,
        name: 'Class-scoped event',
        start_date: '2030-05-01',
        end_date: '2030-05-01',
        audience: CalendarAudience.ALL,
        class_ids: [classId],
      } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );

    expect(created.class_ids).toEqual([classId]);
  });

  it('rejects update/delete on a past event, but today is still editable', async () => {
    const eventRepo = dataSource.getRepository(
      (await import('./entities/calendar-event.entity')).CalendarEvent,
    );
    const pastEvent = await eventRepo.save({
      tenant_id: TENANT_ID,
      academic_year_id: pastSpanningYearId,
      type: CalendarEventType.EVENT,
      name: 'Past event',
      start_date: '2020-01-05',
      end_date: '2020-01-05',
      audience: CalendarAudience.ALL,
      published_at: new Date(),
    });

    await expect(
      service.update(pastEvent.id, { name: 'Renamed' } as any, TENANT_ID, SEED_ADMIN_USER_ID),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.remove(pastEvent.id, TENANT_ID, SEED_ADMIN_USER_ID),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    // "Today" itself must remain editable — assertNotPast compares
    // strictly-less-than, so an event ending today is not locked.
    const { localToday } = await import('../attendance/attendance-policy.util');
    const today = localToday('Asia/Dhaka');
    const todayEvent = await service.create(
      {
        type: CalendarEventType.EVENT,
        name: 'Today event',
        start_date: today,
        end_date: today,
        audience: CalendarAudience.ALL,
      } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    const updated = await service.update(
      todayEvent.id,
      { name: 'Renamed today' } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    expect(updated.name).toBe('Renamed today');
  });

  it('refuses to mark a date non-working when a finalized attendance session exists', async () => {
    const sessionRepo = dataSource.getRepository(AttendanceSession);
    await sessionRepo.save({
      tenant_id: TENANT_ID,
      section_id: sectionId,
      date: '2030-06-10',
      state: AttendanceSessionState.FINALIZED,
    });

    await expect(
      service.create(
        {
          type: CalendarEventType.HOLIDAY,
          name: 'Blocked holiday',
          start_date: '2030-06-10',
          end_date: '2030-06-10',
          audience: CalendarAudience.ALL,
          counts_as_working_day: false,
        } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    // A day with no finalized attendance is unaffected.
    const created = await service.create(
      {
        type: CalendarEventType.HOLIDAY,
        name: 'Unblocked holiday',
        start_date: '2030-06-11',
        end_date: '2030-06-11',
        audience: CalendarAudience.ALL,
        counts_as_working_day: false,
      } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    expect(created.counts_as_working_day).toBe(false);
  });

  it('publish sets published_at once and is idempotent', async () => {
    const draft = await service.create(
      {
        type: CalendarEventType.EVENT,
        name: 'Draft event',
        start_date: '2030-07-01',
        end_date: '2030-07-01',
        audience: CalendarAudience.ALL,
        publish: false,
      } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    expect(draft.published).toBe(false);

    const published = await service.publish(draft.id, TENANT_ID, SEED_ADMIN_USER_ID);
    expect(published.published).toBe(true);
    const firstPublishedAt = published.published_at;

    const republished = await service.publish(draft.id, TENANT_ID, SEED_ADMIN_USER_ID);
    expect(republished.published_at).toEqual(firstPublishedAt);
  });

  it('a draft event is excluded from the default list unless include_drafts is requested by a manage-level viewer', async () => {
    const draft = await service.create(
      {
        type: CalendarEventType.EVENT,
        name: 'Hidden draft',
        start_date: '2030-08-01',
        end_date: '2030-08-01',
        audience: CalendarAudience.ALL,
        publish: false,
      } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );

    const defaultList = await service.list(
      { from: '2030-08-01', to: '2030-08-01' } as any,
      TENANT_ID,
      ADMIN_VIEWER,
    );
    expect(defaultList.data.find((e) => e.id === draft.id)).toBeUndefined();

    const withDrafts = await service.list(
      { from: '2030-08-01', to: '2030-08-01', include_drafts: true } as any,
      TENANT_ID,
      ADMIN_VIEWER,
    );
    expect(withDrafts.data.find((e) => e.id === draft.id)).toBeDefined();
  });

  it('findOne hides an unpublished draft from a viewer without CALENDAR_MANAGE', async () => {
    const draft = await service.create(
      {
        type: CalendarEventType.EVENT,
        name: 'Draft findOne target',
        start_date: '2030-08-05',
        end_date: '2030-08-05',
        audience: CalendarAudience.ALL,
        publish: false,
      } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );

    const teacherViewer = { role: UserRole.TEACHER, userId: SEED_ADMIN_USER_ID, classIds: [] };
    await expect(service.findOne(draft.id, TENANT_ID, teacherViewer)).rejects.toThrow(
      'Calendar event not found',
    );

    // ADMIN (CALENDAR_MANAGE) can still fetch it directly by id.
    const found = await service.findOne(draft.id, TENANT_ID, ADMIN_VIEWER);
    expect(found.id).toBe(draft.id);
  });

  it('filters the list by class_id against the real calendar_event_classes table', async () => {
    const scoped = await service.create(
      {
        type: CalendarEventType.EVENT,
        name: 'Class filter target',
        start_date: '2030-08-10',
        end_date: '2030-08-10',
        audience: CalendarAudience.ALL,
        class_ids: [classId],
      } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    await service.create(
      {
        type: CalendarEventType.EVENT,
        name: 'Unscoped event same day',
        start_date: '2030-08-10',
        end_date: '2030-08-10',
        audience: CalendarAudience.ALL,
      } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );

    // This exercises the raw-SQL EXISTS subquery against
    // `calendar_event_classes` — a wrong table name here 500s instead of
    // filtering, which only a real-Postgres test catches.
    const filtered = await service.list(
      { from: '2030-08-10', to: '2030-08-10', class_id: classId } as any,
      TENANT_ID,
      ADMIN_VIEWER,
    );
    expect(filtered.data.map((e) => e.id)).toEqual([scoped.id]);
  });

  it('TEACHER and PARENT/STUDENT visibility is scoped by class via the real EXISTS subquery', async () => {
    const classScoped = await service.create(
      {
        type: CalendarEventType.EVENT,
        name: 'Visible to class',
        start_date: '2030-08-15',
        end_date: '2030-08-15',
        audience: CalendarAudience.ALL,
        class_ids: [classId],
      } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    const staffOnlyClassScoped = await service.create(
      {
        type: CalendarEventType.EVENT,
        name: 'Staff-only, class scoped',
        start_date: '2030-08-15',
        end_date: '2030-08-15',
        audience: CalendarAudience.STAFF,
        class_ids: [classId],
      } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );

    const teacherInClass = {
      role: UserRole.TEACHER,
      userId: SEED_ADMIN_USER_ID,
      classIds: [classId],
    };
    const teacherList = await service.list(
      { from: '2030-08-15', to: '2030-08-15' } as any,
      TENANT_ID,
      teacherInClass,
    );
    const teacherIds = teacherList.data.map((e) => e.id);
    expect(teacherIds).toContain(classScoped.id);
    expect(teacherIds).toContain(staffOnlyClassScoped.id);

    const parentInClass = {
      role: UserRole.PARENT,
      userId: SEED_ADMIN_USER_ID,
      classIds: [classId],
    };
    const parentList = await service.list(
      { from: '2030-08-15', to: '2030-08-15' } as any,
      TENANT_ID,
      parentInClass,
    );
    const parentIds = parentList.data.map((e) => e.id);
    expect(parentIds).toContain(classScoped.id);
    // STAFF-audience events must never leak to a family role, even when
    // class-scoped to a class the family member belongs to.
    expect(parentIds).not.toContain(staffOnlyClassScoped.id);

    const parentOutsideClass = { role: UserRole.PARENT, userId: SEED_ADMIN_USER_ID, classIds: [] };
    const outsideList = await service.list(
      { from: '2030-08-15', to: '2030-08-15' } as any,
      TENANT_ID,
      parentOutsideClass,
    );
    expect(outsideList.data.map((e) => e.id)).not.toContain(classScoped.id);
  });

  it('publish rejects a draft whose end_date is now in the past', async () => {
    const eventRepo = dataSource.getRepository(
      (await import('./entities/calendar-event.entity')).CalendarEvent,
    );
    const pastDraft = await eventRepo.save({
      tenant_id: TENANT_ID,
      academic_year_id: pastSpanningYearId,
      type: CalendarEventType.EVENT,
      name: 'Stale draft',
      start_date: '2020-01-06',
      end_date: '2020-01-06',
      audience: CalendarAudience.ALL,
      published_at: null,
    });

    await expect(
      service.publish(pastDraft.id, TENANT_ID, SEED_ADMIN_USER_ID),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('publish rejects a draft that now conflicts with finalized attendance', async () => {
    const sessionRepo = dataSource.getRepository(AttendanceSession);
    await sessionRepo.save({
      tenant_id: TENANT_ID,
      section_id: sectionId,
      date: '2030-09-10',
      state: AttendanceSessionState.FINALIZED,
    });

    const eventRepo = dataSource.getRepository(
      (await import('./entities/calendar-event.entity')).CalendarEvent,
    );
    const conflictingDraft = await eventRepo.save({
      tenant_id: TENANT_ID,
      academic_year_id: yearId,
      type: CalendarEventType.HOLIDAY,
      name: 'Conflicting draft holiday',
      start_date: '2030-09-10',
      end_date: '2030-09-10',
      audience: CalendarAudience.ALL,
      counts_as_working_day: false,
      published_at: null,
    });

    await expect(
      service.publish(conflictingDraft.id, TENANT_ID, SEED_ADMIN_USER_ID),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('update can explicitly clear description/start_time/end_time with null', async () => {
    const created = await service.create(
      {
        type: CalendarEventType.EVENT,
        name: 'Clearable fields',
        description: 'Has a description',
        start_time: '09:00',
        end_time: '10:00',
        start_date: '2030-09-15',
        end_date: '2030-09-15',
        audience: CalendarAudience.ALL,
      } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    expect(created.description).toBe('Has a description');

    const updated = await service.update(
      created.id,
      { description: null, start_time: null, end_time: null } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    expect(updated.description).toBeNull();
    expect(updated.start_time).toBeNull();
    expect(updated.end_time).toBeNull();

    // Omitting a field entirely (undefined) must still leave it untouched.
    const untouched = await service.update(
      created.id,
      { name: 'Renamed only' } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
    expect(untouched.description).toBeNull();
  });

  it('rejects a date change that crosses academic years while retaining a class link from the old year', async () => {
    // Pin "today" with a fake clock instead of relying on a hardcoded
    // future date staying future forever — `yearId` spans 2030, which is
    // real today but would eventually become past as wall-clock time
    // advances, making both the source event's create() and this test
    // itself fail at assertNotPast rather than exercising the intended
    // retained-link validation path.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    try {
      const yearRepo = dataSource.getRepository(AcademicYear);
      await yearRepo.save({
        name: 'Calendar Events Far-Future Year',
        start_date: '2050-01-01',
        end_date: '2050-12-31',
        tenant_id: TENANT_ID,
      });

      const created = await service.create(
        {
          type: CalendarEventType.EVENT,
          name: 'Year-crossing event',
          start_date: '2030-09-20',
          end_date: '2030-09-20',
          audience: CalendarAudience.ALL,
          class_ids: [classId],
        } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );
      expect(created.academic_year_id).toBe(yearId);
      expect(created.class_ids).toEqual([classId]);

      // `classId` belongs to `yearId` (2030), not `farFutureYear` (2050)
      // — moving the event's dates into that range without touching
      // class_ids must be rejected rather than silently leaving the
      // retained link pointing at a class from the wrong year.
      await expect(
        service.update(
          created.id,
          { start_date: '2050-06-01', end_date: '2050-06-01' } as any,
          TENANT_ID,
          SEED_ADMIN_USER_ID,
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    } finally {
      vi.useRealTimers();
    }
  });
});
