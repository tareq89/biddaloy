import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, QueryFailedError, Repository } from 'typeorm';
import {
  AttendanceSessionState,
  AttendanceSource,
  AttendanceStatus,
  AuditAction,
  Permission,
  ROLE_PERMISSIONS,
  UserRole,
} from '@biddaloy/shared';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { SchoolHoliday } from '../academics/entities/school-holiday.entity';
import { AttendanceAccessService } from './attendance-access.service';
import { AuditService, RecordAuditEntryInput } from '../audit/audit.service';
import { QueryAuditLogDto } from '../audit/dto/audit-log.dto';
import { AuditLogResponseDto } from '../audit/dto/audit-log-response.dto';
import { SchoolsService } from '../schools/schools.service';
import {
  daysBetween,
  isWeeklyOff,
  localToday,
  resolveAttendancePolicy,
} from './attendance-policy.util';
import { CorrectRecordDto, PutRegisterDto, RegisterResponseDto } from './dto/attendance.dto';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MIN_REASON_LENGTH = 3;

function roleHasPermission(role: string, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role as UserRole] ?? []).includes(permission);
}

function isReasonTooShort(reason: string | undefined): boolean {
  return !reason || reason.trim().length < MIN_REASON_LENGTH;
}

interface RegisterCounts {
  present: number;
  absent: number;
  late: number;
  leave: number;
}

function emptyCounts(): RegisterCounts {
  return { present: 0, absent: 0, late: 0, leave: 0 };
}

function tallyStatus(counts: RegisterCounts, status: AttendanceStatus): void {
  if (status === AttendanceStatus.PRESENT) counts.present += 1;
  else if (status === AttendanceStatus.ABSENT) counts.absent += 1;
  else if (status === AttendanceStatus.LATE) counts.late += 1;
  else if (status === AttendanceStatus.LEAVE) counts.leave += 1;
}

/**
 * The write side of attendance — read a section's register for a day,
 * submit the whole register in one idempotent call, correct a single mark
 * with a mandatory reason, and read that mark's change history. Summaries
 * and reports are [9.4]'s concern, not this service's.
 *
 * Every route delegates object-level access to `AttendanceAccessService`
 * first — `@Roles(...)` on the controller only says "this role may attempt
 * this endpoint", never "this section".
 *
 * `AttendanceRecord` has no persisted `correction_count`/`corrected_at`
 * column — [9.2]'s entity doesn't have one, and adding one here would be a
 * schema change to an already-merged ticket for a value that's cheaply
 * derivable instead. `correction_count` in every response is therefore a
 * COUNT of `UPDATE` `audit_logs` rows for that record, computed with one
 * grouped query per register read (see `getCorrectionCounts`) rather than
 * N+1. `GET /records/:id/history` remains the source of truth for *when*
 * and *why* each correction happened.
 */
@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(AttendanceSession)
    private readonly sessionRepo: Repository<AttendanceSession>,
    @InjectRepository(AttendanceRecord)
    private readonly recordRepo: Repository<AttendanceRecord>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly attendanceAccessService: AttendanceAccessService,
    private readonly auditService: AuditService,
    private readonly schoolsService: SchoolsService,
  ) {}

  // ---------------------------------------------------------------------
  // GET /attendance/my-sections
  // ---------------------------------------------------------------------

  async listMySections(params: { role: string; userId: string; tenantId: string; date?: string }) {
    const { role, userId, tenantId } = params;
    const sections = await this.attendanceAccessService.listMarkableSections(
      role,
      userId,
      tenantId,
    );
    if (sections.length === 0) return [];

    // `date` defaults to the tenant's local today (not the server's UTC
    // day) when the caller doesn't supply one — this is the teacher's
    // landing screen, so "today" must mean the school's today.
    const date =
      params.date ??
      localToday(
        (await this.schoolsService.getResolvedSettings(tenantId)).region?.timezone ?? 'UTC',
      );

    const sectionIds = sections.map((s) => s.id);

    // One grouped query for every section's roster size, not one per section.
    const studentCountRows = await this.studentRepo
      .createQueryBuilder('s')
      .select('s.class_section_id', 'section_id')
      .addSelect('COUNT(*)', 'count')
      .where('s.tenant_id = :tenantId', { tenantId })
      .andWhere('s.deleted_at IS NULL')
      .andWhere('s.class_section_id IN (:...sectionIds)', { sectionIds })
      .groupBy('s.class_section_id')
      .getRawMany<{ section_id: string; count: string }>();
    const studentCounts = new Map(studentCountRows.map((r) => [r.section_id, Number(r.count)]));

    // One query for every section's session on this date, not one per section.
    const sessions = await this.sessionRepo.find({
      where: { tenant_id: tenantId, section_id: In(sectionIds), date },
    });
    const sessionBySectionId = new Map(sessions.map((s) => [s.section_id, s]));
    const sessionIds = sessions.map((s) => s.id);

    const countsBySessionId = new Map<string, RegisterCounts>();
    if (sessionIds.length > 0) {
      const rows = await this.recordRepo
        .createQueryBuilder('r')
        .select('r.session_id', 'session_id')
        .addSelect('r.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('r.tenant_id = :tenantId', { tenantId })
        .andWhere('r.session_id IN (:...sessionIds)', { sessionIds })
        .groupBy('r.session_id')
        .addGroupBy('r.status')
        .getRawMany<{ session_id: string; status: AttendanceStatus; count: string }>();

      for (const row of rows) {
        const entry = countsBySessionId.get(row.session_id) ?? emptyCounts();
        const n = Number(row.count);
        if (row.status === AttendanceStatus.PRESENT) entry.present += n;
        else if (row.status === AttendanceStatus.ABSENT) entry.absent += n;
        else if (row.status === AttendanceStatus.LATE) entry.late += n;
        else if (row.status === AttendanceStatus.LEAVE) entry.leave += n;
        countsBySessionId.set(row.session_id, entry);
      }
    }

    return sections.map((section) => {
      const session = sessionBySectionId.get(section.id);
      const studentCount = studentCounts.get(section.id) ?? 0;
      const className = (section as ClassSection & { class?: { name: string } }).class?.name ?? '';

      let today = null;
      if (session) {
        const counts = countsBySessionId.get(session.id) ?? emptyCounts();
        const marked = counts.present + counts.absent + counts.late + counts.leave;
        today = {
          state: session.state,
          present: counts.present,
          absent: counts.absent,
          late: counts.late,
          leave: counts.leave,
          unmarked: Math.max(studentCount - marked, 0),
          marked_at: session.marked_at ? session.marked_at.toISOString() : null,
        };
      }

      return {
        section_id: section.id,
        section_name: section.section_name,
        class_name: className,
        student_count: studentCount,
        today,
      };
    });
  }

  // ---------------------------------------------------------------------
  // GET /attendance/sections/:sectionId/register
  // ---------------------------------------------------------------------

  async getRegister(params: {
    sectionId: string;
    date: string;
    periodNo: number | null;
    tenantId: string;
    role: string;
    userId: string;
  }): Promise<RegisterResponseDto> {
    const { sectionId, date, periodNo, tenantId, role, userId } = params;
    await this.attendanceAccessService.assertCanAccessSection(role, userId, sectionId, tenantId);
    return this.loadRegister(this.dataSource.manager, {
      sectionId,
      date,
      periodNo,
      tenantId,
      role,
    });
  }

  // ---------------------------------------------------------------------
  // PUT /attendance/sections/:sectionId/register
  // ---------------------------------------------------------------------

  async putRegister(params: {
    sectionId: string;
    tenantId: string;
    role: string;
    userId: string;
    dto: PutRegisterDto;
    ip: string | null;
    userAgent: string | null;
  }): Promise<RegisterResponseDto> {
    const { sectionId, tenantId, role, userId, dto, ip, userAgent } = params;

    // 1. Object-level access.
    await this.attendanceAccessService.assertCanAccessSection(role, userId, sectionId, tenantId);

    // 3. Date sanity.
    if (!DATE_ONLY.test(dto.date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }

    const periodNo = dto.period_no ?? null;

    // 8 (part). Duplicate student_id is a 400 (malformed request), checked
    // before anything transactional.
    const studentIds = dto.entries.map((e) => e.student_id);
    if (new Set(studentIds).size !== studentIds.length) {
      throw new BadRequestException('entries contains a duplicate student_id');
    }

    // Wrapped rather than left to propagate as a 500: when no session exists
    // yet, two concurrent PUTs both pass the pessimistic-lock lookup with a
    // null result, then race to insert — the loser hits `UQ_att_session`.
    // That's a version conflict in spirit, not a server error, so it's
    // mapped to the same 409 the version check above already returns.
    try {
      return await this.dataSource.transaction(async (manager) => {
        const sessionRepo = manager.getRepository(AttendanceSession);
        const recordRepo = manager.getRepository(AttendanceRecord);
        const studentRepo = manager.getRepository(Student);

        const settings = await this.schoolsService.getResolvedSettings(tenantId);
        const policy = resolveAttendancePolicy(settings);
        const timezone = settings.region?.timezone ?? 'UTC';
        const today = localToday(timezone);

        // Pessimistic lock: two concurrent PUTs for the same session must serialize,
        // not both read the same version and race to overwrite each other.
        let session = await sessionRepo.findOne({
          where: {
            tenant_id: tenantId,
            section_id: sectionId,
            date: dto.date,
            period_no: periodNo === null ? IsNull() : periodNo,
          },
          lock: { mode: 'pessimistic_write' },
        });

        // 2. Idempotency — checked before the version check, so a replay of an
        // already-accepted write reads as a 200, never as a conflict.
        if (session && session.last_client_request_id === dto.client_request_id) {
          return this.loadRegister(manager, {
            sectionId,
            date: dto.date,
            periodNo,
            tenantId,
            role,
          });
        }

        // 4. Future date.
        if (dto.date > today) {
          if (!policy.allowFutureDates) {
            throw new UnprocessableEntityException({
              message: 'Cannot mark attendance for a future date',
              details: { code: 'ATTENDANCE_FUTURE_DATE' },
            });
          }
          const hasNonLeaveEntry = dto.entries.some((e) => e.status !== AttendanceStatus.LEAVE);
          if (hasNonLeaveEntry) {
            throw new UnprocessableEntityException({
              message: 'Only LEAVE may be marked for a future date',
              details: { code: 'ATTENDANCE_FUTURE_NOT_LEAVE' },
            });
          }
        }

        // 5. Non-working day. The holiday lookup here is a stand-in for
        // [9.4]'s SchoolCalendarService, which doesn't exist yet — do not
        // block this ticket on it.
        const hasCorrect = roleHasPermission(role, Permission.ATTENDANCE_CORRECT);
        const nonWorkingDay =
          isWeeklyOff(dto.date, policy) || (await this.isHoliday(manager, tenantId, dto.date));
        if (nonWorkingDay && !(dto.force_non_working_day === true && hasCorrect)) {
          throw new UnprocessableEntityException({
            message: 'Cannot mark attendance on a non-working day',
            details: { code: 'ATTENDANCE_NON_WORKING_DAY' },
          });
        }

        // 6. Correction window — only applies when correcting an *existing*
        // register; the first-ever submission for a day is never "outside
        // the window".
        const age = daysBetween(dto.date, today);
        if (session && age > policy.correctionWindowDays) {
          if (!hasCorrect) {
            throw new ForbiddenException({
              message: 'This register is outside the correction window',
              details: { code: 'ATTENDANCE_WINDOW_CLOSED' },
            });
          }
          if (isReasonTooShort(dto.reason)) {
            throw new UnprocessableEntityException({
              message: `A reason of at least ${MIN_REASON_LENGTH} characters is required to correct this register`,
              details: { code: 'ATTENDANCE_REASON_REQUIRED' },
            });
          }
        }

        // 6a. Finalized registers are locked against routine edits. Only a
        // caller holding ATTENDANCE_CORRECT may reopen one, and only with a
        // reason — otherwise a same-section caller could silently overwrite a
        // finalized register just by matching its base_version.
        if (session && session.state === AttendanceSessionState.FINALIZED) {
          if (!hasCorrect) {
            throw new ForbiddenException({
              message: 'This register has been finalized',
              details: { code: 'ATTENDANCE_FINALIZED' },
            });
          }
          if (isReasonTooShort(dto.reason)) {
            throw new UnprocessableEntityException({
              message: `A reason of at least ${MIN_REASON_LENGTH} characters is required to edit a finalized register`,
              details: { code: 'ATTENDANCE_REASON_REQUIRED' },
            });
          }
        }

        // 7. Version — a mismatch carries the full current register, which is
        // the payload [8.12.5]'s conflict dialog renders.
        const currentVersion = session?.version ?? 0;
        if (dto.base_version !== currentVersion) {
          const currentRegister = await this.loadRegister(manager, {
            sectionId,
            date: dto.date,
            periodNo,
            tenantId,
            role,
          });
          throw new ConflictException({
            message: 'This register has changed since you last loaded it',
            details: {
              code: 'ATTENDANCE_VERSION_CONFLICT',
              current_version: currentVersion,
              register: currentRegister,
            },
          });
        }

        // 8. Roster membership.
        const uniqueStudentIds = [...new Set(studentIds)];
        const roster =
          uniqueStudentIds.length > 0
            ? await studentRepo.find({
                where: {
                  id: In(uniqueStudentIds),
                  class_section_id: sectionId,
                  tenant_id: tenantId,
                },
              })
            : [];
        const rosterIds = new Set(roster.map((s) => s.id));
        const unknownStudentIds = uniqueStudentIds.filter((id) => !rosterIds.has(id));
        if (unknownStudentIds.length > 0) {
          throw new UnprocessableEntityException({
            message: 'One or more students are not enrolled in this section',
            details: { code: 'ATTENDANCE_UNKNOWN_STUDENTS', student_ids: unknownStudentIds },
          });
        }

        // --- Write ---------------------------------------------------------
        const isNewSession = !session;
        if (!session) {
          // `state`'s DB default only applies when the column is omitted from
          // the INSERT — set it explicitly so the in-memory entity (and this
          // request's audit/response payload) isn't left with `undefined`
          // rather than the row's real value.
          session = sessionRepo.create({
            tenant_id: tenantId,
            section_id: sectionId,
            date: dto.date,
            period_no: periodNo,
            source: AttendanceSource.TEACHER,
            state: AttendanceSessionState.DRAFT,
          });
        }
        session.state = dto.finalize ? AttendanceSessionState.FINALIZED : session.state;
        session.marked_by_user_id = userId;
        session.marked_at = new Date();
        session.last_client_request_id = dto.client_request_id;
        if (dto.finalize) {
          session.finalized_at = new Date();
        }
        session = await sessionRepo.save(session);

        const existingRecords = await recordRepo.find({
          where: { session_id: session.id, tenant_id: tenantId },
        });
        const existingByStudentId = new Map(existingRecords.map((r) => [r.student_id, r]));

        const recordAudits: RecordAuditEntryInput[] = [];
        const counts = emptyCounts();

        for (const entry of dto.entries) {
          tallyStatus(counts, entry.status);
          const minutesLate =
            entry.status === AttendanceStatus.LATE ? (entry.minutes_late ?? null) : null;
          const remarks = entry.remarks ?? null;
          const existing = existingByStudentId.get(entry.student_id);

          if (!existing) {
            const created = await recordRepo.save(
              recordRepo.create({
                tenant_id: tenantId,
                session_id: session.id,
                student_id: entry.student_id,
                date: session.date,
                status: entry.status,
                minutes_late: minutesLate,
                remarks,
                source: AttendanceSource.TEACHER,
                recorded_by_user_id: userId,
              }),
            );
            recordAudits.push({
              action: AuditAction.CREATE,
              entity_type: 'AttendanceRecord',
              entity_id: created.id,
              tenant_id: tenantId,
              performed_by_user_id: userId,
              ip_address: ip,
              user_agent: userAgent,
              old_values: null,
              new_values: {
                status: created.status,
                minutes_late: created.minutes_late,
                remarks: created.remarks,
              },
            });
            continue;
          }

          const changed =
            existing.status !== entry.status ||
            existing.minutes_late !== minutesLate ||
            existing.remarks !== remarks;
          // Unchanged records get no audit row — a register submitted twice
          // with the same marks must not produce a wall of audit noise.
          if (!changed) continue;

          const oldValues = {
            status: existing.status,
            minutes_late: existing.minutes_late,
            remarks: existing.remarks,
          };
          existing.status = entry.status;
          existing.minutes_late = minutesLate;
          existing.remarks = remarks;
          existing.recorded_by_user_id = userId;
          await recordRepo.save(existing);

          recordAudits.push({
            action: AuditAction.UPDATE,
            entity_type: 'AttendanceRecord',
            entity_id: existing.id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: ip,
            user_agent: userAgent,
            old_values: oldValues,
            new_values: {
              status: existing.status,
              minutes_late: existing.minutes_late,
              remarks: existing.remarks,
              reason: dto.reason ?? null,
            },
          });
        }

        await this.auditService.record(
          {
            action: isNewSession ? AuditAction.CREATE : AuditAction.UPDATE,
            entity_type: 'AttendanceSession',
            entity_id: session.id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: ip,
            user_agent: userAgent,
            old_values: null,
            new_values: {
              date: session.date,
              period_no: session.period_no,
              state: session.state,
              version: session.version,
              counts,
            },
          },
          manager,
        );

        for (const entry of recordAudits) {
          await this.auditService.record(entry, manager);
        }

        return this.loadRegister(manager, { sectionId, date: dto.date, periodNo, tenantId, role });
      });
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505'
      ) {
        throw new ConflictException({
          message: 'This register was just created by another request',
          details: { code: 'ATTENDANCE_SESSION_RACE' },
        });
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // POST /attendance/sections/:sectionId/register/finalize
  // ---------------------------------------------------------------------

  async finalize(params: {
    sectionId: string;
    tenantId: string;
    role: string;
    userId: string;
    date: string;
    periodNo: number | null;
    ip: string | null;
    userAgent: string | null;
  }): Promise<RegisterResponseDto> {
    const { sectionId, tenantId, role, userId, date, periodNo, ip, userAgent } = params;
    await this.attendanceAccessService.assertCanAccessSection(role, userId, sectionId, tenantId);

    return this.dataSource.transaction(async (manager) => {
      const sessionRepo = manager.getRepository(AttendanceSession);
      const session = await sessionRepo.findOne({
        where: {
          tenant_id: tenantId,
          section_id: sectionId,
          date,
          period_no: periodNo === null ? IsNull() : periodNo,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) {
        throw new NotFoundException('No register exists for this section and date yet');
      }

      // Idempotent: finalizing an already-finalized session is a no-op, so
      // [9.8]'s cut-off sweep can call this without checking state first.
      if (session.state !== AttendanceSessionState.FINALIZED) {
        const wasState = session.state;
        session.state = AttendanceSessionState.FINALIZED;
        session.finalized_at = new Date();
        session.marked_by_user_id = userId;
        await sessionRepo.save(session);

        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'AttendanceSession',
            entity_id: session.id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: ip,
            user_agent: userAgent,
            old_values: { state: wasState },
            new_values: { state: session.state, finalized_at: session.finalized_at },
          },
          manager,
        );
      }

      return this.loadRegister(manager, { sectionId, date, periodNo, tenantId, role });
    });
  }

  // ---------------------------------------------------------------------
  // PATCH /attendance/records/:recordId
  // ---------------------------------------------------------------------

  async correctRecord(params: {
    recordId: string;
    tenantId: string;
    role: string;
    userId: string;
    dto: CorrectRecordDto;
    ip: string | null;
    userAgent: string | null;
  }): Promise<RegisterResponseDto> {
    const { recordId, tenantId, role, userId, dto, ip, userAgent } = params;

    // `reason` is always required on this route — it only ever edits
    // something that already exists.
    if (isReasonTooShort(dto.reason)) {
      throw new UnprocessableEntityException({
        message: `A reason of at least ${MIN_REASON_LENGTH} characters is required`,
        details: { code: 'ATTENDANCE_REASON_REQUIRED' },
      });
    }

    return this.dataSource.transaction(async (manager) => {
      const recordRepo = manager.getRepository(AttendanceRecord);
      const sessionRepo = manager.getRepository(AttendanceSession);

      const record = await recordRepo.findOne({ where: { id: recordId, tenant_id: tenantId } });
      if (!record) {
        throw new NotFoundException('Attendance record not found');
      }
      const session = await sessionRepo.findOne({
        where: { id: record.session_id, tenant_id: tenantId },
      });
      if (!session) {
        throw new NotFoundException('Attendance session not found');
      }

      await this.attendanceAccessService.assertCanAccessSection(
        role,
        userId,
        session.section_id,
        tenantId,
      );

      const settings = await this.schoolsService.getResolvedSettings(tenantId);
      const policy = resolveAttendancePolicy(settings);
      const timezone = settings.region?.timezone ?? 'UTC';
      const age = daysBetween(session.date, localToday(timezone));
      const hasCorrect = roleHasPermission(role, Permission.ATTENDANCE_CORRECT);

      if (age > policy.correctionWindowDays && !hasCorrect) {
        throw new ForbiddenException({
          message: 'This record is outside the correction window',
          details: { code: 'ATTENDANCE_WINDOW_CLOSED' },
        });
      }

      const oldValues = {
        status: record.status,
        minutes_late: record.minutes_late,
        remarks: record.remarks,
      };
      record.status = dto.status;
      record.minutes_late =
        dto.status === AttendanceStatus.LATE ? (dto.minutes_late ?? null) : null;
      record.remarks = dto.remarks ?? null;
      record.recorded_by_user_id = userId;
      await recordRepo.save(record);

      // Bumps the parent session's version explicitly (rather than relying
      // on TypeORM's diff-based UPDATE, which may omit the column entirely
      // if no other tracked field changed) so a marking screen holding a
      // stale version finds out on its next read.
      await sessionRepo.increment({ id: session.id }, 'version', 1);
      session.version += 1;

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'AttendanceRecord',
          entity_id: record.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: ip,
          user_agent: userAgent,
          old_values: oldValues,
          new_values: {
            status: record.status,
            minutes_late: record.minutes_late,
            remarks: record.remarks,
            reason: dto.reason,
          },
        },
        manager,
      );

      return this.loadRegister(manager, {
        sectionId: session.section_id,
        date: session.date,
        periodNo: session.period_no,
        tenantId,
        role,
      });
    });
  }

  // ---------------------------------------------------------------------
  // GET /attendance/records/:recordId/history
  // ---------------------------------------------------------------------

  /**
   * Gated on section access, not `AUDIT_LOG_READ` — a teacher legitimately
   * needs to see who changed a mark in their own register, and must not be
   * handed the tenant-wide audit log to get it.
   */
  async getRecordHistory(params: {
    recordId: string;
    tenantId: string;
    role: string;
    userId: string;
    query: QueryAuditLogDto;
  }) {
    const { recordId, tenantId, role, userId, query } = params;

    const record = await this.recordRepo.findOne({ where: { id: recordId, tenant_id: tenantId } });
    if (!record) {
      throw new NotFoundException('Attendance record not found');
    }
    const session = await this.sessionRepo.findOne({
      where: { id: record.session_id, tenant_id: tenantId },
    });
    if (!session) {
      throw new NotFoundException('Attendance session not found');
    }

    await this.attendanceAccessService.assertCanAccessSection(
      role,
      userId,
      session.section_id,
      tenantId,
    );

    const result = await this.auditService.findByEntity(
      'AttendanceRecord',
      recordId,
      query,
      tenantId,
    );
    return { ...result, data: result.data.map(AuditLogResponseDto.fromEntity) };
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private async isHoliday(
    manager: EntityManager,
    tenantId: string,
    dateIso: string,
  ): Promise<boolean> {
    // TODO(9.4): replace with the shared SchoolCalendarService once it
    // exists. It doesn't exist in this ticket, so this queries
    // `school_holidays` directly rather than block on 9.4.
    const count = await manager
      .getRepository(SchoolHoliday)
      .createQueryBuilder('h')
      .where('h.tenant_id = :tenantId', { tenantId })
      .andWhere('h.deleted_at IS NULL')
      .andWhere(':date BETWEEN h.start_date AND h.end_date', { date: dateIso })
      .andWhere('h.counts_as_working_day = false')
      .getCount();
    return count > 0;
  }

  /** See the class docstring for why this is derived rather than a column. */
  private async getCorrectionCounts(
    manager: EntityManager,
    tenantId: string,
    recordIds: string[],
  ): Promise<Map<string, number>> {
    if (recordIds.length === 0) return new Map();
    const rows: Array<{ entity_id: string; count: string }> = await manager.query(
      `SELECT entity_id, COUNT(*) AS count FROM audit_logs
       WHERE tenant_id = $1 AND entity_type = 'AttendanceRecord' AND action = 'UPDATE'
         AND entity_id = ANY($2::uuid[])
       GROUP BY entity_id`,
      [tenantId, recordIds],
    );
    return new Map(rows.map((r) => [r.entity_id, Number(r.count)]));
  }

  /**
   * The one place that assembles the `RegisterResponseDto` shape, shared by
   * `getRegister`, every `putRegister`/`finalize`/`correctRecord` return
   * (including the idempotent-replay and 409-conflict payloads), so the
   * client can always replace its state wholesale from any of these calls.
   *
   * Takes an `EntityManager` rather than using the injected repositories
   * directly so it reads consistently whether called from a plain GET (the
   * `DataSource`'s own manager) or from inside a write's transaction (that
   * transaction's manager, seeing its own uncommitted writes).
   *
   * Does not itself check access — every caller has already called
   * `AttendanceAccessService.assertCanAccessSection` (or, for
   * `putRegister`'s conflict path, is re-deriving state for a call that
   * already passed that check).
   */
  private async loadRegister(
    manager: EntityManager,
    params: {
      sectionId: string;
      date: string;
      periodNo: number | null;
      tenantId: string;
      role: string;
    },
  ): Promise<RegisterResponseDto> {
    const { sectionId, date, periodNo, tenantId, role } = params;

    const section = await manager.getRepository(ClassSection).findOne({
      where: { id: sectionId, tenant_id: tenantId },
      relations: ['class'],
    });
    if (!section) {
      throw new ForbiddenException('You do not have access to this section');
    }

    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const policy = resolveAttendancePolicy(settings);
    const timezone = settings.region?.timezone ?? 'UTC';

    const session = await manager.getRepository(AttendanceSession).findOne({
      where: {
        tenant_id: tenantId,
        section_id: sectionId,
        date,
        period_no: periodNo === null ? IsNull() : periodNo,
      },
    });

    // roll_number is an int column, so this ORDER BY is already
    // numeric — no varchar-sort trap (1, 10, 2, ...) to work around.
    const students = await manager.getRepository(Student).find({
      where: { class_section_id: sectionId, tenant_id: tenantId },
      order: { roll_number: 'ASC' },
    });

    const records = session
      ? await manager
          .getRepository(AttendanceRecord)
          .find({ where: { session_id: session.id, tenant_id: tenantId } })
      : [];
    const recordsByStudentId = new Map(records.map((r) => [r.student_id, r]));
    const correctionCounts = await this.getCorrectionCounts(
      manager,
      tenantId,
      records.map((r) => r.id),
    );

    const hasCorrect = roleHasPermission(role, Permission.ATTENDANCE_CORRECT);
    const nonWorkingDay =
      isWeeklyOff(date, policy) || (await this.isHoliday(manager, tenantId, date));
    const today = localToday(timezone);
    const reasonRequired = !!session && daysBetween(date, today) > policy.correctionWindowDays;
    const finalized = session?.state === AttendanceSessionState.FINALIZED;
    const editable =
      (!nonWorkingDay || hasCorrect) &&
      (!reasonRequired || hasCorrect) &&
      (!finalized || hasCorrect);

    return {
      section: {
        id: section.id,
        section_name: section.section_name,
        class_name: (section as ClassSection & { class?: { name: string } }).class?.name ?? '',
      },
      session: session
        ? {
            id: session.id,
            date: session.date,
            period_no: session.period_no,
            state: session.state,
            version: session.version,
            marked_by_user_id: session.marked_by_user_id,
            marked_at: session.marked_at ? session.marked_at.toISOString() : null,
            finalized_at: session.finalized_at ? session.finalized_at.toISOString() : null,
          }
        : {
            id: null,
            date,
            period_no: periodNo,
            state: AttendanceSessionState.DRAFT,
            version: 0,
            marked_by_user_id: null,
            marked_at: null,
            finalized_at: null,
          },
      editable,
      reason_required: reasonRequired,
      non_working_day: nonWorkingDay,
      policy: {
        late_after: policy.lateAfter,
        correction_window_days: policy.correctionWindowDays,
        allow_future_dates: policy.allowFutureDates,
      },
      students: students.map((s) => {
        const record = recordsByStudentId.get(s.id);
        return {
          student_id: s.id,
          roll_number: s.roll_number,
          full_name: s.full_name,
          record_id: record?.id ?? null,
          status: record?.status ?? null,
          minutes_late: record?.minutes_late ?? null,
          remarks: record?.remarks ?? null,
          source: record?.source ?? null,
          correction_count: record ? (correctionCounts.get(record.id) ?? 0) : 0,
        };
      }),
    };
  }
}
