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
  AuditAction,
  CalendarEventType,
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
    /** Trusted, non-DTO override for callers that already picked a specific
     * academic year out-of-band (clone-to-year's commit path) — bypasses
     * `resolveAcademicYear`'s date-range lookup, which can't disambiguate
     * between two academic years whose ranges overlap and would otherwise
     * silently land the event in the wrong one. Never sourced from client
     * input. */
    expectedAcademicYearId?: string,
  ): Promise<CalendarEventWithClassIds> {
    if (dto.end_date < dto.start_date) {
      throw new UnprocessableEntityException({
        message: '"end_date" must not be earlier than "start_date"',
        details: { code: 'CALENDAR_INVALID_RANGE' },
      });
    }

    const isMakeup = dto.type === CalendarEventType.MAKEUP_DAY;
    if (isMakeup) {
      this.assertMakeupCounts(dto.counts_as_working_day);
    }

    // A past event is locked, with one exception (TIME-06): a closure
    // (`counts_as_working_day` false) may be recorded after the fact, with a
    // reason, as long as no register has marks in the range (checked below).
    // A closure is "past" once any of its days has passed (its start), so a
    // range from yesterday to tomorrow also needs the reason and is silent.
    const today = await this.getToday(tenantId);
    const isClosure = !isMakeup && dto.counts_as_working_day === false;
    if (dto.end_date < today && !isClosure) {
      throw this.lockedError();
    }
    const isPastClosure = isClosure && dto.start_date < today;
    const reason = dto.reason?.trim() ?? '';
    if (isPastClosure) {
      if (reason.length < 3) {
        throw new UnprocessableEntityException({
          message: 'A reason is required to add a closure for a day that has passed',
          details: { code: 'CALENDAR_REASON_REQUIRED' },
        });
      }
    }

    const academicYear = expectedAcademicYearId
      ? await this.assertInsideYear(tenantId, expectedAcademicYearId, dto.start_date, dto.end_date)
      : await this.resolveAcademicYear(tenantId, dto.start_date, dto.end_date);
    const classIds = await this.assertClassesInTenant(tenantId, dto.class_ids, academicYear.id);

    // A make-up day adds a school day, it never removes one, so no register
    // can contradict it.
    const countsAsWorkingDay = isMakeup ? true : (dto.counts_as_working_day ?? false);
    if (!countsAsWorkingDay) {
      await this.assertNoAttendanceInRange(tenantId, dto.start_date, dto.end_date, classIds);
    }

    // A past closure is always live at once and never announced (no SMS
    // about a day that is over).
    const publish = isPastClosure ? true : (dto.publish ?? true);
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
      counts_as_working_day: countsAsWorkingDay,
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
      new_values: {
        ...saved,
        class_ids: classIds,
        ...(isPastClosure ? { reason } : {}),
      },
    });

    const [withClassIds] = await this.withClassIds([saved], tenantId);
    // D9: a draft (`publish: false`) is never notified — `publish()` sends
    // the notify instead, once the event actually goes live.
    if (publish && !isPastClosure) {
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
    /** Same trusted override as `create()`'s — see there for why. */
    expectedAcademicYearId?: string,
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

    const academicYear = expectedAcademicYearId
      ? await this.assertInsideYear(tenantId, expectedAcademicYearId, nextStart, nextEnd)
      : await this.resolveAcademicYear(tenantId, nextStart, nextEnd);

    const nextType = dto.type ?? event.type;
    const wasMakeup = event.type === CalendarEventType.MAKEUP_DAY;
    if (nextType === CalendarEventType.MAKEUP_DAY) {
      this.assertMakeupCounts(dto.counts_as_working_day);
    }
    // A make-up day turned into another type falls back to that type's
    // default (not a working day), like create; its forced `true` must not stick.
    const nextCountsAsWorkingDay =
      nextType === CalendarEventType.MAKEUP_DAY
        ? true
        : (dto.counts_as_working_day ?? (wasMakeup ? false : event.counts_as_working_day));
    if (
      wasMakeup &&
      (nextType !== CalendarEventType.MAKEUP_DAY ||
        nextStart !== event.start_date ||
        nextEnd !== event.end_date)
    ) {
      await this.assertMakeupDaysUnmarked(event);
    }
    // Validate the class ids first, so an unknown class is CALENDAR_INVALID_CLASS rather
    // than whatever the attendance guard would say about a class that does not exist.
    let classIds: string[] | undefined;
    if (dto.class_ids !== undefined) {
      classIds = await this.assertClassesInTenant(tenantId, dto.class_ids, academicYear.id);
    } else if (academicYear.id !== event.academic_year_id) {
      // The patch didn't touch class_ids, but a date change moved the
      // event into a different academic year — the retained links were
      // validated against the *old* year and Class rows are scoped per
      // year, so silently keeping them would leave the event pointing at
      // classes from a year it no longer belongs to (visibility joins
      // only match on event_id/class_id, so this would leak the event to
      // the wrong year's viewers). Re-validate the same links against the
      // new year; reject the update if any no longer belong.
      const retainedLinks = await this.eventClassRepo.find({ where: { event_id: event.id } });
      const retainedClassIds = retainedLinks.map((link) => link.class_id);
      if (retainedClassIds.length > 0) {
        await this.assertClassesInTenant(tenantId, retainedClassIds, academicYear.id);
      }
    }

    if (!nextCountsAsWorkingDay) {
      // `classIds` is the validated explicit list (possibly empty = school-wide);
      // omitted means the event keeps its current links.
      const guardClassIds = classIds ?? (await this.classIdsOf(event.id));
      await this.assertNoAttendanceInRange(tenantId, nextStart, nextEnd, guardClassIds);
    }

    Object.assign(event, {
      type: nextType,
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
    if (event.type === CalendarEventType.MAKEUP_DAY) {
      await this.assertMakeupDaysUnmarked(event);
    }

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
        await this.assertNoAttendanceInRange(
          tenantId,
          event.start_date,
          event.end_date,
          await this.classIdsOf(event.id),
        );
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
      throw this.lockedError();
    }
  }

  /**
   * A make-up day whose dates are going away (delete, move, retype) must not
   * have registers with marks: they would land on a day that no longer
   * counts. ponytail: checks the whole old range, even a make-up day that sat
   * on a normal school day; narrow to weekly off-days if that ever bites.
   */
  private async assertMakeupDaysUnmarked(event: CalendarEvent): Promise<void> {
    await this.assertNoAttendanceInRange(
      event.tenant_id,
      event.start_date,
      event.end_date,
      await this.classIdsOf(event.id),
    );
  }

  private lockedError(): UnprocessableEntityException {
    return new UnprocessableEntityException({
      message: 'This calendar event is in the past and can no longer be changed',
      details: { code: 'CALENDAR_EVENT_LOCKED' },
    });
  }

  /** A make-up day exists to ADD a school day; "does not count" is a contradiction. */
  private assertMakeupCounts(countsAsWorkingDay: boolean | undefined): void {
    if (countsAsWorkingDay === false) {
      throw new UnprocessableEntityException({
        message: 'A make-up school day always counts as a working day',
        details: { code: 'CALENDAR_MAKEUP_MUST_COUNT' },
      });
    }
  }

  private async classIdsOf(eventId: string): Promise<string[]> {
    const links = await this.eventClassRepo.find({ where: { event_id: eventId } });
    return links.map((link) => link.class_id);
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

  /**
   * Same boundary checks as `resolveAcademicYear`, but for a caller that
   * already knows which specific academic year the event belongs to
   * (clone-to-year's commit path picked it explicitly) rather than one
   * that needs it looked up by date — a lookup that can't disambiguate
   * when two academic years' ranges overlap.
   */
  private async assertInsideYear(
    tenantId: string,
    academicYearId: string,
    startDate: string,
    endDate: string,
  ): Promise<AcademicYear> {
    const year = await this.academicYearRepo.findOne({
      where: { id: academicYearId, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!year) {
      throw new UnprocessableEntityException({
        message: 'This date range falls outside any academic year',
        details: { code: 'CALENDAR_OUTSIDE_ACADEMIC_YEAR' },
      });
    }
    if (
      startDate < String(year.start_date) ||
      endDate < String(year.start_date) ||
      endDate > String(year.end_date)
    ) {
      throw new UnprocessableEntityException({
        message: 'This event crosses an academic-year boundary',
        details: { code: 'CALENDAR_OUTSIDE_ACADEMIC_YEAR' },
      });
    }
    return year;
  }

  /** Every `class_ids` entry must be a `Class` row in this tenant AND in
   * the event's own academic year — a class from another tenant, another
   * academic year, or one that doesn't exist, is rejected rather than
   * silently dropped or scoped incorrectly (calendar visibility joins on
   * `class_id` alone, so a cross-year class link would leak the event to
   * students in a class that has since moved to a different year). */
  private async assertClassesInTenant(
    tenantId: string,
    classIds: string[] | undefined,
    academicYearId: string,
  ): Promise<string[]> {
    if (!classIds || classIds.length === 0) return [];
    const found = await this.classRepo
      .createQueryBuilder('class')
      .where('class.id IN (:...ids)', { ids: classIds })
      .andWhere('class.tenant_id = :tenantId', { tenantId })
      .andWhere('class.academic_year_id = :academicYearId', { academicYearId })
      .getMany();
    if (found.length !== new Set(classIds).size) {
      throw new UnprocessableEntityException({
        message: 'One or more class_ids do not belong to this tenant and academic year',
        details: { code: 'CALENDAR_INVALID_CLASS' },
      });
    }
    return classIds;
  }

  /**
   * A day that would stop counting as a working day (a holiday, or any
   * non-working event) cannot be created over a date that already has a
   * register with marks in it — that register already assumed the day was a
   * school day. Any state counts (a DRAFT register with marks is real
   * data), a session with no records does not. A class-scoped event is only
   * blocked by registers of its own classes; a school-wide one is also
   * blocked by staff attendance.
   */
  private async assertNoAttendanceInRange(
    tenantId: string,
    startDate: string,
    endDate: string,
    classIds: string[],
  ): Promise<void> {
    const scoped = classIds.length > 0;
    const studentRows: Array<{ n: number }> = await this.attendanceSessionRepo.manager.query(
      `SELECT COUNT(*)::int AS n FROM attendance_sessions s
       WHERE s.tenant_id = $1 AND s.date >= $2 AND s.date <= $3
         AND EXISTS (SELECT 1 FROM attendance_records r
                     WHERE r.session_id = s.id AND r.tenant_id = $1)
         ${
           scoped
             ? `AND s.section_id IN (SELECT cs.id FROM class_sections cs
                                     WHERE cs.tenant_id = $1 AND cs.class_id = ANY($4::uuid[]))`
             : ''
         }`,
      scoped ? [tenantId, startDate, endDate, classIds] : [tenantId, startDate, endDate],
    );
    let found = studentRows[0].n;
    if (found === 0 && !scoped) {
      const staffRows: Array<{ n: number }> = await this.attendanceSessionRepo.manager.query(
        `SELECT COUNT(*)::int AS n FROM staff_attendance_sessions s
         WHERE s.tenant_id = $1 AND s.date >= $2 AND s.date <= $3
           AND EXISTS (SELECT 1 FROM staff_attendance_records r
                       WHERE r.session_id = s.id AND r.tenant_id = $1)`,
        [tenantId, startDate, endDate],
      );
      found = staffRows[0].n;
    }
    if (found > 0) {
      throw new UnprocessableEntityException({
        message: 'This date range already has attendance and cannot be marked non-working',
        details: { code: 'CALENDAR_DAY_HAS_ATTENDANCE' },
      });
    }
  }
}
