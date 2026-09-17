import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarEventClass } from './entities/calendar-event-class.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { AttendanceSession } from '../attendance/entities/attendance-session.entity';
import {
  CreateCalendarEventDto,
  QueryCalendarEventsDto,
  UpdateCalendarEventDto,
} from './dto/calendar-events.dto';
import { CalendarViewer, visibilityWhere } from './calendar-visibility.util';
import { CalendarNotifyService } from './calendar-notify.service';
import { SchoolsService } from '../schools/schools.service';
import { FamilyAccessService } from '../students/family-access.service';
import { AuditService } from '../audit/audit.service';
import { localToday } from '../attendance/attendance-policy.util';
import {
  AttendanceSessionState,
  AuditAction,
  Permission,
  UserRole,
  isGuardianRole,
  roleHasPermission,
} from '@biddaloy/shared';

/** Same ceiling as `SchoolCalendarService.getWorkingDays` — an unbounded
 * `from`/`to` list query is how this endpoint becomes a way to make the
 * server build a huge result set. */
const MAX_RANGE_DAYS = 400;

export interface CalendarEventWithClassIds extends CalendarEvent {
  class_ids: string[];
  /** `true` once the event's `end_date` is strictly before the tenant's
   * local "today" — matches `assertNotPast`'s own rule (D6). */
  is_locked: boolean;
  published: boolean;
}

/**
 * Owns every read and write of `CalendarEvent` beyond the legacy
 * holiday-only surface `SchoolCalendarService` keeps (17.x). Every route in
 * `CalendarEventsController` goes through here — the past-lock check, the
 * academic-year derivation, the visibility predicate, and the
 * already-has-attendance guard each have exactly one implementation, here.
 */
@Injectable()
export class CalendarEventsService {
  constructor(
    @InjectRepository(CalendarEvent)
    private readonly eventRepo: Repository<CalendarEvent>,
    @InjectRepository(CalendarEventClass)
    private readonly eventClassRepo: Repository<CalendarEventClass>,
    @InjectRepository(AcademicYear)
    private readonly academicYearRepo: Repository<AcademicYear>,
    @InjectRepository(Class)
    private readonly classRepo: Repository<Class>,
    @InjectRepository(TeacherClassSection)
    private readonly teacherClassSectionRepo: Repository<TeacherClassSection>,
    @InjectRepository(AttendanceSession)
    private readonly attendanceSessionRepo: Repository<AttendanceSession>,
    private readonly schoolsService: SchoolsService,
    private readonly familyAccessService: FamilyAccessService,
    private readonly notifyService: CalendarNotifyService,
    private readonly auditService: AuditService,
  ) {}

  // -------------------------------------------------------------------
  // Viewer resolution
  // -------------------------------------------------------------------

  /**
   * Resolves the caller's own visibility scope. TEACHER's `classIds` come
   * from the sections they're assigned to (`TeacherClassSection`);
   * PARENT/STUDENT's come from their linked students' current class,
   * via `FamilyAccessService` — the one place linkage is decided.
   */
  async resolveViewer(role: string, userId: string, tenantId: string): Promise<CalendarViewer> {
    if (role === UserRole.TEACHER) {
      const rows = await this.teacherClassSectionRepo
        .createQueryBuilder('tcs')
        .innerJoin('tcs.section', 'section')
        .where('tcs.tenant_id = :tenantId', { tenantId })
        .andWhere('tcs.teacher_id = :userId', { userId })
        .select('DISTINCT section.class_id', 'class_id')
        .getRawMany<{ class_id: string }>();
      return { role, userId, classIds: rows.map((r) => r.class_id) };
    }

    if (isGuardianRole(role)) {
      const students = await this.familyAccessService.getLinkedStudents(role, userId, tenantId);
      const classIds = Array.from(
        new Set(
          students.map((s) => s.class_section?.class?.id).filter((id): id is string => Boolean(id)),
        ),
      );
      return { role, userId, classIds };
    }

    return { role, userId, classIds: [] };
  }

  // -------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------

  async list(
    query: QueryCalendarEventsDto,
    tenantId: string,
    viewer: CalendarViewer,
  ): Promise<{
    data: CalendarEventWithClassIds[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = query.page || 1;
    const limit = query.limit || 10;

    if (query.from && query.to) {
      const days =
        (new Date(query.to).getTime() - new Date(query.from).getTime()) / (24 * 60 * 60 * 1000) + 1;
      if (days > MAX_RANGE_DAYS) {
        throw new UnprocessableEntityException({
          message: `Range must not exceed ${MAX_RANGE_DAYS} days`,
          details: { code: 'CALENDAR_RANGE_TOO_WIDE' },
        });
      }
    }

    const qb = this.eventRepo
      .createQueryBuilder('event')
      .where('event.tenant_id = :tenantId', { tenantId })
      .andWhere('event.deleted_at IS NULL');

    // Drafts are only visible to a caller with manage-level access who
    // explicitly asked for them (D9).
    const canSeeDrafts = roleHasPermission(viewer.role, Permission.CALENDAR_MANAGE);
    if (!canSeeDrafts || !query.include_drafts) {
      qb.andWhere('event.published_at IS NOT NULL');
    }

    if (query.from) {
      qb.andWhere('event.end_date >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('event.start_date <= :to', { to: query.to });
    }
    if (query.types && query.types.length > 0) {
      qb.andWhere('event.type IN (:...types)', { types: query.types });
    }
    if (query.audience) {
      qb.andWhere('event.audience = :audience', { audience: query.audience });
    }
    if (query.class_id) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM calendar_event_classes cec WHERE cec.event_id = event.id AND cec.class_id = :classId)`,
        { classId: query.class_id },
      );
    }

    visibilityWhere(qb, viewer);

    const [events, total] = await qb
      .orderBy('event.start_date', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const data = await this.withClassIds(events, tenantId);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) || 0 };
  }

  async findOne(
    id: string,
    tenantId: string,
    viewer: CalendarViewer,
  ): Promise<CalendarEventWithClassIds> {
    const qb = this.eventRepo
      .createQueryBuilder('event')
      .where('event.id = :id', { id })
      .andWhere('event.tenant_id = :tenantId', { tenantId })
      .andWhere('event.deleted_at IS NULL');

    // Same draft rule as `list()`: a viewer without CALENDAR_MANAGE can
    // never fetch an unpublished draft by id, even if they know its id.
    if (!roleHasPermission(viewer.role, Permission.CALENDAR_MANAGE)) {
      qb.andWhere('event.published_at IS NOT NULL');
    }

    visibilityWhere(qb, viewer);

    const event = await qb.getOne();
    if (!event) {
      throw new NotFoundException('Calendar event not found');
    }
    const [withClassIds] = await this.withClassIds([event], tenantId);
    return withClassIds;
  }

  private async withClassIds(
    events: CalendarEvent[],
    tenantId: string,
  ): Promise<CalendarEventWithClassIds[]> {
    if (events.length === 0) return [];
    const today = await this.getToday(tenantId);
    const links = await this.eventClassRepo
      .createQueryBuilder('cec')
      .where('cec.event_id IN (:...ids)', { ids: events.map((e) => e.id) })
      .andWhere('cec.tenant_id = :tenantId', { tenantId })
      .getMany();
    const byEvent = new Map<string, string[]>();
    for (const link of links) {
      const list = byEvent.get(link.event_id) ?? [];
      list.push(link.class_id);
      byEvent.set(link.event_id, list);
    }
    return events.map((event) => ({
      ...event,
      class_ids: byEvent.get(event.id) ?? [],
      is_locked: event.end_date < today,
      published: event.published_at !== null,
    }));
  }

  private async getToday(tenantId: string): Promise<string> {
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const timezone = settings.region?.timezone ?? 'UTC';
    return localToday(timezone);
  }

  // -------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------

  async create(
    dto: CreateCalendarEventDto,
    tenantId: string,
    userId: string,
  ): Promise<CalendarEventWithClassIds> {
    if (dto.end_date < dto.start_date) {
      throw new UnprocessableEntityException({
        message: '"end_date" must not be earlier than "start_date"',
        details: { code: 'CALENDAR_INVALID_RANGE' },
      });
    }

    await this.assertNotPast(tenantId, dto.end_date);

    const academicYear = await this.resolveAcademicYear(tenantId, dto.start_date, dto.end_date);
    const classIds = await this.assertClassesInTenant(tenantId, dto.class_ids);

    if (dto.counts_as_working_day === false || dto.counts_as_working_day === undefined) {
      await this.assertNoAttendanceInRange(tenantId, dto.start_date, dto.end_date);
    }

    const publish = dto.publish ?? true;
    const event = this.eventRepo.create({
      tenant_id: tenantId,
      academic_year_id: academicYear.id,
      type: dto.type,
      name: dto.name,
      description: dto.description ?? null,
      start_date: dto.start_date,
      end_date: dto.end_date,
      start_time: dto.start_time ?? null,
      end_time: dto.end_time ?? null,
      counts_as_working_day: dto.counts_as_working_day ?? false,
      audience: dto.audience,
      published_at: publish ? new Date() : null,
      created_by_user_id: userId,
      updated_by_user_id: userId,
    });
    const saved = await this.eventRepo.save(event);

    if (classIds.length > 0) {
      await this.eventClassRepo.save(
        classIds.map((classId) => ({ event_id: saved.id, class_id: classId, tenant_id: tenantId })),
      );
    }

    await this.auditService.record({
      action: AuditAction.CREATE,
      entity_type: 'CalendarEvent',
      entity_id: saved.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      old_values: null,
      new_values: { ...saved, class_ids: classIds },
    });

    const [withClassIds] = await this.withClassIds([saved], tenantId);
    // D9: a draft (`publish: false`) is never notified — `publish()` sends
    // the notify instead, once the event actually goes live.
    if (publish) {
      await this.notifyService.eventCreated(saved, {
        notify: dto.notify,
        notifySms: dto.notify_sms,
      });
    }
    return withClassIds;
  }

  async update(
    id: string,
    dto: UpdateCalendarEventDto,
    tenantId: string,
    userId: string,
  ): Promise<CalendarEventWithClassIds> {
    const event = await this.findEntityOrThrow(id, tenantId);
    const oldValues = { ...event };

    // Past-lock applies to the event's *current* end_date — a locked event
    // cannot be touched at all, regardless of what the patch tries to set.
    await this.assertNotPast(tenantId, event.end_date);

    const nextStart = dto.start_date ?? event.start_date;
    const nextEnd = dto.end_date ?? event.end_date;
    if (nextEnd < nextStart) {
      throw new UnprocessableEntityException({
        message: '"end_date" must not be earlier than "start_date"',
        details: { code: 'CALENDAR_INVALID_RANGE' },
      });
    }
    await this.assertNotPast(tenantId, nextEnd);

    const academicYear = await this.resolveAcademicYear(tenantId, nextStart, nextEnd);

    const nextCountsAsWorkingDay = dto.counts_as_working_day ?? event.counts_as_working_day;
    if (!nextCountsAsWorkingDay) {
      await this.assertNoAttendanceInRange(tenantId, nextStart, nextEnd);
    }

    let classIds: string[] | undefined;
    if (dto.class_ids !== undefined) {
      classIds = await this.assertClassesInTenant(tenantId, dto.class_ids);
    }

    Object.assign(event, {
      type: dto.type ?? event.type,
      name: dto.name ?? event.name,
      // `null` is an explicit "clear this field"; only an absent
      // (`undefined`) key falls back to the existing value.
      description: dto.description === undefined ? event.description : dto.description,
      start_date: nextStart,
      end_date: nextEnd,
      start_time: dto.start_time === undefined ? event.start_time : dto.start_time,
      end_time: dto.end_time === undefined ? event.end_time : dto.end_time,
      counts_as_working_day: nextCountsAsWorkingDay,
      audience: dto.audience ?? event.audience,
      academic_year_id: academicYear.id,
      updated_by_user_id: userId,
    });
    const saved = await this.eventRepo.save(event);

    if (classIds !== undefined) {
      await this.eventClassRepo.delete({ event_id: saved.id });
      if (classIds.length > 0) {
        await this.eventClassRepo.save(
          classIds.map((classId) => ({
            event_id: saved.id,
            class_id: classId,
            tenant_id: tenantId,
          })),
        );
      }
    }

    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'CalendarEvent',
      entity_id: saved.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      old_values: oldValues,
      new_values: { ...saved },
    });

    const [withClassIds] = await this.withClassIds([saved], tenantId);
    if (saved.published_at) {
      await this.notifyService.eventUpdated(saved, {
        notify: dto.notify,
        notifySms: dto.notify_sms,
      });
    }
    return withClassIds;
  }

  async remove(id: string, tenantId: string, userId: string): Promise<void> {
    const event = await this.findEntityOrThrow(id, tenantId);
    await this.assertNotPast(tenantId, event.end_date);

    await this.eventRepo.softDelete({ id, tenant_id: tenantId });

    await this.auditService.record({
      action: AuditAction.DELETE,
      entity_type: 'CalendarEvent',
      entity_id: event.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      old_values: { ...event },
      new_values: null,
    });
  }

  async publish(id: string, tenantId: string, userId: string): Promise<CalendarEventWithClassIds> {
    const event = await this.findEntityOrThrow(id, tenantId);
    if (!event.published_at) {
      // Same guards as create/update — a stale draft (past `end_date`, or
      // now conflicting with attendance finalized since it was drafted)
      // must not be allowed to go live unchecked.
      await this.assertNotPast(tenantId, event.end_date);
      if (!event.counts_as_working_day) {
        await this.assertNoAttendanceInRange(tenantId, event.start_date, event.end_date);
      }
      event.published_at = new Date();
      event.updated_by_user_id = userId;
      await this.eventRepo.save(event);
      await this.auditService.record({
        action: AuditAction.UPDATE,
        entity_type: 'CalendarEvent',
        entity_id: event.id,
        tenant_id: tenantId,
        performed_by_user_id: userId,
        old_values: { published_at: null },
        new_values: { published_at: event.published_at },
      });
    }
    const [withClassIds] = await this.withClassIds([event], tenantId);
    return withClassIds;
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  private async findEntityOrThrow(id: string, tenantId: string): Promise<CalendarEvent> {
    const event = await this.eventRepo.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!event) {
      throw new NotFoundException('Calendar event not found');
    }
    return event;
  }

  /**
   * D6: an event cannot be created, edited, or deleted once its `end_date`
   * is strictly before the tenant's local "today" — otherwise a past
   * attendance-affecting entry could be rewritten after the fact. "Today"
   * itself is still editable.
   */
  private async assertNotPast(tenantId: string, endDate: string): Promise<void> {
    const today = await this.getToday(tenantId);
    if (endDate < today) {
      throw new UnprocessableEntityException({
        message: 'This calendar event is in the past and can no longer be changed',
        details: { code: 'CALENDAR_EVENT_LOCKED' },
      });
    }
  }

  /**
   * Derives the academic year a `[start_date, end_date]` range belongs to.
   * Both ends must fall in the *same* academic year — an event spanning a
   * year boundary has no single owner and is rejected rather than silently
   * picked by one end.
   */
  private async resolveAcademicYear(
    tenantId: string,
    startDate: string,
    endDate: string,
  ): Promise<AcademicYear> {
    const startYear = await this.academicYearRepo
      .createQueryBuilder('ay')
      .where('ay.tenant_id = :tenantId', { tenantId })
      .andWhere('ay.deleted_at IS NULL')
      .andWhere('ay.start_date <= :startDate', { startDate })
      .andWhere('ay.end_date >= :startDate', { startDate })
      .getOne();

    if (!startYear) {
      throw new UnprocessableEntityException({
        message: 'This date range falls outside any academic year',
        details: { code: 'CALENDAR_OUTSIDE_ACADEMIC_YEAR' },
      });
    }

    if (endDate < String(startYear.start_date) || endDate > String(startYear.end_date)) {
      throw new UnprocessableEntityException({
        message: 'This event crosses an academic-year boundary',
        details: { code: 'CALENDAR_OUTSIDE_ACADEMIC_YEAR' },
      });
    }

    return startYear;
  }

  /** Every `class_ids` entry must be a `Class` row in this tenant — a class
   * id from another tenant, or one that doesn't exist, is rejected rather
   * than silently dropped. */
  private async assertClassesInTenant(
    tenantId: string,
    classIds: string[] | undefined,
  ): Promise<string[]> {
    if (!classIds || classIds.length === 0) return [];
    const found = await this.classRepo
      .createQueryBuilder('class')
      .where('class.id IN (:...ids)', { ids: classIds })
      .andWhere('class.tenant_id = :tenantId', { tenantId })
      .getMany();
    if (found.length !== new Set(classIds).size) {
      throw new UnprocessableEntityException({
        message: 'One or more class_ids do not belong to this tenant',
        details: { code: 'CALENDAR_INVALID_CLASS' },
      });
    }
    return classIds;
  }

  /**
   * A day that would stop counting as a working day (a holiday, or any
   * non-working event) cannot be created over a date that already has a
   * finalized attendance register — that register already assumed the day
   * was a school day when it was marked.
   */
  private async assertNoAttendanceInRange(
    tenantId: string,
    startDate: string,
    endDate: string,
  ): Promise<void> {
    const count = await this.attendanceSessionRepo
      .createQueryBuilder('session')
      .where('session.tenant_id = :tenantId', { tenantId })
      .andWhere('session.date >= :startDate', { startDate })
      .andWhere('session.date <= :endDate', { endDate })
      .andWhere('session.state = :state', { state: AttendanceSessionState.FINALIZED })
      .getCount();
    if (count > 0) {
      throw new UnprocessableEntityException({
        message:
          'This date range already has finalized attendance and cannot be marked non-working',
        details: { code: 'CALENDAR_DAY_HAS_ATTENDANCE' },
      });
    }
  }
}
