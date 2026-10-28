import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, QueryFailedError } from 'typeorm';
import {
  AttendanceSource,
  AttendanceStatus,
  AuditAction,
  GUARDIAN_ROLES,
  Permission,
  roleHasPermission,
} from '@biddaloy/shared';
import { StaffAttendanceSession } from './entities/staff-attendance-session.entity';
import { StaffAttendanceRecord } from './entities/staff-attendance-record.entity';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { StaffProfilesService } from '../staff-profiles/staff-profiles.service';
import { AuditService, RecordAuditEntryInput } from '../audit/audit.service';
import { SchoolsService } from '../schools/schools.service';
import { SchoolCalendarService } from '../calendar/school-calendar.service';
import {
  daysBetween,
  localToday,
  resolveAttendancePolicy,
} from '../attendance/attendance-policy.util';
import {
  PutStaffAttendanceRegisterDto,
  StaffAttendanceDayDto,
  StaffAttendanceRegisterResponseDto,
} from './dto/staff-attendance.dto';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MIN_REASON_LENGTH = 3;

function isReasonTooShort(reason: string | undefined): boolean {
  return !reason || reason.trim().length < MIN_REASON_LENGTH;
}

/**
 * The write side of staff attendance — mark/correct a whole day's staff
 * marks in one call. Unlike `AttendanceService`, there is no
 * `base_version`/idempotency dance: staff attendance is admin/self-marked,
 * not offline-queued, so a plain find-or-create session + upsert per
 * record is enough (D3, [36.2.2] plan).
 *
 * The correction rule reused from `docs/architecture/11-attendance.md`
 * §4: inside the tenant's `correctionWindowDays`, a `STAFF_ATTENDANCE_MARK`
 * holder edits freely; outside it, the same holder needs a reason
 * (>=3 chars), and every such correction is audited.
 */
@Injectable()
export class StaffAttendanceService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly schoolsService: SchoolsService,
    private readonly staffProfilesService: StaffProfilesService,
    private readonly schoolCalendarService: SchoolCalendarService,
  ) {}

  /**
   * The roster the caller may mark on `date`, with that day's saved marks.
   * Admin-level callers (`LEAVE_APPROVE`, the same test `markDay` uses) see
   * every staff member; anyone else sees only their own row.
   */
  async getDay(params: {
    tenantId: string;
    role: string;
    userId: string;
    date: string;
  }): Promise<StaffAttendanceDayDto> {
    const { tenantId, role, userId, date } = params;
    if (!DATE_ONLY.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }
    const isAdmin = roleHasPermission(role, Permission.LEAVE_APPROVE);

    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const policy = resolveAttendancePolicy(settings);
    const today = localToday(settings.region?.timezone ?? 'UTC');

    // The member's staff role: one live, non-guardian membership (a person can
    // hold several roles; the alphabetical first keeps the row unique).
    // ponytail: no limit param — one tenant's staff, capped in practice by the
    // PUT's ArrayMaxSize(1000); page it if a school ever outgrows that.
    const rows: {
      staff_profile_id: string;
      user_id: string;
      full_name: string;
      role: string;
      status: AttendanceStatus | null;
    }[] = await this.dataSource.query(
      `SELECT sp.id AS staff_profile_id, u.id AS user_id, u.full_name,
              (SELECT ut.role FROM user_tenants ut
                WHERE ut.user_id = u.id AND ut.tenant_id = sp.tenant_id
                  AND ut.deleted_at IS NULL AND ut.role::text <> ALL($3::text[])
                ORDER BY ut.role::text LIMIT 1) AS role,
              r.status
         FROM staff_profiles sp
         JOIN users u ON u.id = sp.user_id AND u.deleted_at IS NULL
         LEFT JOIN staff_attendance_sessions s ON s.tenant_id = sp.tenant_id AND s.date = $2
         LEFT JOIN staff_attendance_records r
           ON r.session_id = s.id AND r.staff_profile_id = sp.id AND r.tenant_id = sp.tenant_id
        WHERE sp.tenant_id = $1
          AND ($4::uuid IS NULL OR sp.user_id = $4::uuid)
          AND EXISTS (SELECT 1 FROM user_tenants ut
                WHERE ut.user_id = u.id AND ut.tenant_id = sp.tenant_id
                  AND ut.deleted_at IS NULL AND ut.role::text <> ALL($3::text[]))
        ORDER BY u.full_name, sp.id`,
      [tenantId, date, [...GUARDIAN_ROLES], isAdmin ? null : userId],
    );

    const sessionRows: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM staff_attendance_sessions WHERE tenant_id = $1 AND date = $2`,
      [tenantId, date],
    );
    const nonWorking = await this.schoolCalendarService.isNonWorkingDay({ tenantId, date });

    return {
      date,
      // Same formula as `markDay`: a saved day older than the correction window.
      reason_required:
        sessionRows.length > 0 && daysBetween(date, today) > policy.correctionWindowDays,
      non_working_day: nonWorking,
      staff: rows,
    };
  }

  /**
   * D21: stamp LEAVE on every working day of an approved leave. Runs only on
   * the caller's `manager` (no inner transaction); DB errors propagate so the
   * caller's transaction rolls back. PRESENT/LATE/LEAVE marks are kept,
   * ABSENT becomes LEAVE (audited). No correction-window/reason check: this is
   * a system effect of an approval, not a manual edit.
   */
  async markLeaveRange(
    manager: EntityManager,
    params: {
      tenantId: string;
      staffProfileId: string;
      from: string;
      to: string;
      actorUserId: string;
      applicationId: string;
    },
  ): Promise<{ dates: string[] }> {
    const { tenantId, staffProfileId, from, to, actorUserId, applicationId } = params;
    const { dates: workingDates } = await this.schoolCalendarService.getWorkingDays({
      tenantId,
      from,
      to,
    });
    const dates: string[] = [];
    const sessionRepo = manager.getRepository(StaffAttendanceSession);
    const recordRepo = manager.getRepository(StaffAttendanceRecord);

    for (const date of workingDates) {
      // orIgnore: a concurrent markDay may create the day; a unique violation
      // here would abort the caller's whole transaction.
      await sessionRepo
        .createQueryBuilder()
        .insert()
        .values({ tenant_id: tenantId, date })
        .orIgnore()
        .execute();
      const session = await sessionRepo.findOneOrFail({
        where: { tenant_id: tenantId, date },
        lock: { mode: 'pessimistic_write' },
      });

      const existing = await recordRepo.findOne({
        where: { tenant_id: tenantId, session_id: session.id, staff_profile_id: staffProfileId },
      });
      if (existing && existing.status !== AttendanceStatus.ABSENT) {
        if (existing.status === AttendanceStatus.LEAVE) dates.push(date);
        continue;
      }

      if (!existing) {
        const created = await recordRepo.save(
          recordRepo.create({
            tenant_id: tenantId,
            session_id: session.id,
            staff_profile_id: staffProfileId,
            status: AttendanceStatus.LEAVE,
            source: AttendanceSource.SYSTEM,
          }),
        );
        await this.auditService.record(
          {
            action: AuditAction.CREATE,
            entity_type: 'StaffAttendanceRecord',
            entity_id: created.id,
            tenant_id: tenantId,
            performed_by_user_id: actorUserId,
            old_values: null,
            new_values: { status: AttendanceStatus.LEAVE, application_id: applicationId },
          },
          manager,
        );
      } else {
        existing.status = AttendanceStatus.LEAVE;
        await recordRepo.save(existing);
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'StaffAttendanceRecord',
            entity_id: existing.id,
            tenant_id: tenantId,
            performed_by_user_id: actorUserId,
            old_values: { status: AttendanceStatus.ABSENT },
            new_values: { status: AttendanceStatus.LEAVE, application_id: applicationId },
          },
          manager,
        );
      }
      await sessionRepo.increment({ id: session.id, tenant_id: tenantId }, 'version', 1);
      dates.push(date);
    }
    return { dates };
  }

  /**
   * D31: undo `markLeaveRange` for a cancelled leave. Only future (strictly
   * after today, or every day with `includePast`) SYSTEM-sourced LEAVE marks
   * of this staff profile are deleted, so those days are unmarked (#2381); an
   * ABSENT this leave turned into LEAVE goes back to ABSENT. Other marks stay.
   * Returns the changed dates and the school's `today` it used, so the
   * ledger can keep the same cut.
   */
  async revertLeaveRange(
    manager: EntityManager,
    params: {
      tenantId: string;
      staffProfileId: string;
      from: string;
      to: string;
      actorUserId: string;
      applicationId: string;
      /** Also delete past and today's marks (a leave approved by mistake). */
      includePast?: boolean;
    },
  ): Promise<{ dates: string[]; today: string }> {
    const { tenantId, staffProfileId, from, to, actorUserId, applicationId, includePast } = params;
    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const today = localToday(settings.region?.timezone ?? 'UTC');
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const start = includePast || from > tomorrow ? from : tomorrow;
    if (start > to) return { dates: [], today };

    const recordRepo = manager.getRepository(StaffAttendanceRecord);
    const sessionRepo = manager.getRepository(StaffAttendanceSession);

    // #2381: an ABSENT that `markLeaveRange` turned into LEAVE keeps its own
    // (manual) source, so the SYSTEM delete below never sees it. Put back the
    // ABSENT, but only where this leave's own audit row did the turning and
    // nobody has edited the mark since.
    const restored: { id: string; session_id: string; date: string }[] = await manager.query(
      `SELECT r.id, r.session_id, s.date::text AS date
       FROM staff_attendance_records r
       JOIN staff_attendance_sessions s ON s.id = r.session_id AND s.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1 AND r.staff_profile_id = $2 AND r.status = $3
         AND s.date BETWEEN $4 AND $5
         AND EXISTS (
           SELECT 1 FROM audit_logs a
           WHERE a.tenant_id = $1 AND a.entity_type = 'StaffAttendanceRecord' AND a.entity_id = r.id
             AND a.action = 'UPDATE' AND a.old_values->>'status' = $6
             AND a.new_values->>'application_id' = $7
             AND NOT EXISTS (
               SELECT 1 FROM audit_logs later
               WHERE later.tenant_id = $1 AND later.entity_type = 'StaffAttendanceRecord'
                 AND later.entity_id = r.id AND later.created_at > a.created_at))
       ORDER BY s.date
       FOR UPDATE OF r`,
      [
        tenantId,
        staffProfileId,
        AttendanceStatus.LEAVE,
        start,
        to,
        AttendanceStatus.ABSENT,
        applicationId,
      ],
    );
    for (const row of restored) {
      await recordRepo.update(
        { id: row.id, tenant_id: tenantId },
        { status: AttendanceStatus.ABSENT },
      );
      await sessionRepo.increment({ id: row.session_id, tenant_id: tenantId }, 'version', 1);
      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'StaffAttendanceRecord',
          entity_id: row.id,
          tenant_id: tenantId,
          performed_by_user_id: actorUserId,
          old_values: { status: AttendanceStatus.LEAVE },
          new_values: { status: AttendanceStatus.ABSENT, application_id: applicationId },
        },
        manager,
      );
    }

    const rows = await recordRepo
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.session', 's')
      .setLock('pessimistic_write')
      .where('r.tenant_id = :tenantId', { tenantId })
      .andWhere('s.tenant_id = :tenantId', { tenantId })
      .andWhere('r.staff_profile_id = :staffProfileId', { staffProfileId })
      .andWhere('r.status = :status', { status: AttendanceStatus.LEAVE })
      .andWhere('r.source = :source', { source: AttendanceSource.SYSTEM })
      .andWhere('s.date BETWEEN :start AND :to', { start, to })
      .orderBy('s.date')
      .getMany();

    for (const row of rows) {
      await recordRepo.delete({ id: row.id, tenant_id: tenantId });
      await sessionRepo.increment({ id: row.session_id, tenant_id: tenantId }, 'version', 1);
      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'StaffAttendanceRecord',
          entity_id: row.id,
          tenant_id: tenantId,
          performed_by_user_id: actorUserId,
          old_values: { status: AttendanceStatus.LEAVE },
          new_values: { application_id: applicationId },
        },
        manager,
      );
    }
    const dates = [...restored.map((r) => r.date), ...rows.map((r) => r.session.date)].sort();
    return { dates, today };
  }

  async markDay(params: {
    tenantId: string;
    role: string;
    userId: string;
    dto: PutStaffAttendanceRegisterDto;
    ip: string | null;
    userAgent: string | null;
  }): Promise<StaffAttendanceRegisterResponseDto> {
    const { tenantId, role, userId, dto, ip, userAgent } = params;

    if (!DATE_ONLY.test(dto.date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }

    const staffProfileIds = dto.entries.map((e) => e.staff_profile_id);
    if (new Set(staffProfileIds).size !== staffProfileIds.length) {
      throw new BadRequestException('entries contains a duplicate staff_profile_id');
    }

    // `STAFF_ATTENDANCE_MARK` is held by every tenant role, but only for
    // their own record — ADMIN/EXECUTIVE additionally get it for all staff
    // (`shared/src/enums/permissions.ts`'s comment on this permission).
    // `LEAVE_APPROVE` happens to be held by exactly that same ADMIN/
    // EXECUTIVE pair, so it doubles as the "admin-level attendance" check
    // without a new permission, same pattern
    // `leave.service.ts#assertStaffProfileAccessible` uses.
    // Non-admins may only create their own mark, for today, on a working
    // day; anything else (other dates, changing an existing mark) is
    // admin-only (TIME-01).
    const isAdmin = roleHasPermission(role, Permission.LEAVE_APPROVE);
    if (!isAdmin) {
      const ownStaffProfileId = await this.staffProfilesService.findIdByUserId(userId, tenantId);
      const notOwn = staffProfileIds.some((id) => id !== ownStaffProfileId);
      if (notOwn) {
        throw new ForbiddenException({
          message: 'You may only mark your own attendance',
          details: { code: 'STAFF_ATTENDANCE_NOT_OWN_PROFILE' },
        });
      }
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const sessionRepo = manager.getRepository(StaffAttendanceSession);
        const recordRepo = manager.getRepository(StaffAttendanceRecord);
        const staffProfileRepo = manager.getRepository(StaffProfile);

        const settings = await this.schoolsService.getResolvedSettings(tenantId);
        const policy = resolveAttendancePolicy(settings);
        const timezone = settings.region?.timezone ?? 'UTC';
        const today = localToday(timezone);

        if (!isAdmin && dto.date !== today) {
          throw new ForbiddenException({
            message: 'You can only mark your own attendance for today',
            details: { code: 'STAFF_ATTENDANCE_SELF_TODAY_ONLY' },
          });
        }
        if (dto.date > today && dto.entries.some((e) => e.status !== AttendanceStatus.LEAVE)) {
          throw new UnprocessableEntityException({
            message: 'Only LEAVE may be marked for a future date',
            details: { code: 'STAFF_ATTENDANCE_FUTURE_NOT_LEAVE' },
          });
        }
        // Staff have no class, so the check is tenant-wide.
        const nonWorking = await this.schoolCalendarService.isNonWorkingDay({
          tenantId,
          date: dto.date,
        });
        if (nonWorking && !(isAdmin && dto.force_non_working_day === true)) {
          throw new UnprocessableEntityException({
            message: 'Cannot mark attendance on a non-working day',
            details: { code: 'STAFF_ATTENDANCE_NON_WORKING_DAY' },
          });
        }

        // Pessimistic lock: two concurrent PUTs for the same day must
        // serialize, matching `AttendanceService.putRegister`'s reasoning.
        let session = await sessionRepo.findOne({
          where: { tenant_id: tenantId, date: dto.date },
          lock: { mode: 'pessimistic_write' },
        });

        const isNewSession = !session;
        const age = daysBetween(dto.date, today);
        if (session && age > policy.correctionWindowDays) {
          // No separate "blocked entirely outside the window" role exists
          // today — every `STAFF_ATTENDANCE_MARK` holder (enforced by
          // `PermissionsGuard` on this route already) may correct, they
          // just need a reason. `docs/architecture/11-attendance.md` §4.
          if (isReasonTooShort(dto.reason)) {
            throw new UnprocessableEntityException({
              message: `A reason of at least ${MIN_REASON_LENGTH} characters is required to correct this day`,
              details: { code: 'STAFF_ATTENDANCE_REASON_REQUIRED' },
            });
          }
        }

        const uniqueStaffProfileIds = [...new Set(staffProfileIds)];
        const knownProfiles =
          uniqueStaffProfileIds.length > 0
            ? await staffProfileRepo.find({
                where: { tenant_id: tenantId, id: In(uniqueStaffProfileIds) },
              })
            : [];
        const knownIds = new Set(knownProfiles.map((p) => p.id));
        const unknownIds = uniqueStaffProfileIds.filter((id) => !knownIds.has(id));
        if (unknownIds.length > 0) {
          throw new UnprocessableEntityException({
            message: 'One or more staff profiles do not belong to this tenant',
            details: { code: 'STAFF_ATTENDANCE_UNKNOWN_STAFF', staff_profile_ids: unknownIds },
          });
        }

        if (!session) {
          session = sessionRepo.create({ tenant_id: tenantId, date: dto.date });
        }
        session = await sessionRepo.save(session);

        const existingRecords = await recordRepo.find({
          where: { session_id: session.id, tenant_id: tenantId },
        });
        const existingByStaffProfileId = new Map(
          existingRecords.map((r) => [r.staff_profile_id, r]),
        );

        const audits: RecordAuditEntryInput[] = [];
        const responseRecords: {
          staff_profile_id: string;
          record_id: string;
          status: AttendanceStatus;
        }[] = [];

        for (const entry of dto.entries) {
          const existing = existingByStaffProfileId.get(entry.staff_profile_id);

          if (!existing) {
            const created = await recordRepo.save(
              recordRepo.create({
                tenant_id: tenantId,
                session_id: session.id,
                staff_profile_id: entry.staff_profile_id,
                status: entry.status,
                source: AttendanceSource.TEACHER,
              }),
            );
            audits.push({
              action: AuditAction.CREATE,
              entity_type: 'StaffAttendanceRecord',
              entity_id: created.id,
              tenant_id: tenantId,
              performed_by_user_id: userId,
              ip_address: ip,
              user_agent: userAgent,
              old_values: null,
              new_values: { status: created.status },
            });
            responseRecords.push({
              staff_profile_id: created.staff_profile_id,
              record_id: created.id,
              status: created.status,
            });
            continue;
          }

          if (existing.status === entry.status) {
            // Unchanged marks get no audit row — resubmitting the same day
            // must not produce a wall of audit noise.
            responseRecords.push({
              staff_profile_id: existing.staff_profile_id,
              record_id: existing.id,
              status: existing.status,
            });
            continue;
          }

          if (!isAdmin) {
            // Covers an admin's mark and a SYSTEM LEAVE row from `markLeaveRange`.
            throw new ForbiddenException({
              message: 'This mark was already recorded; ask an admin to correct it',
              details: { code: 'STAFF_ATTENDANCE_ALREADY_MARKED' },
            });
          }

          const oldStatus = existing.status;
          existing.status = entry.status;
          await recordRepo.save(existing);

          audits.push({
            action: AuditAction.UPDATE,
            entity_type: 'StaffAttendanceRecord',
            entity_id: existing.id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: ip,
            user_agent: userAgent,
            old_values: { status: oldStatus },
            new_values: { status: existing.status, reason: dto.reason ?? null },
          });
          responseRecords.push({
            staff_profile_id: existing.staff_profile_id,
            record_id: existing.id,
            status: existing.status,
          });
        }

        if (!isNewSession && audits.length > 0) {
          // Bumps the session's version explicitly, same reasoning as
          // `AttendanceService.correctRecord` — a diff-based UPDATE may
          // omit the column entirely if nothing else on the session changed.
          await sessionRepo.increment({ id: session.id }, 'version', 1);
          session.version += 1;
        }

        for (const entry of audits) {
          await this.auditService.record(entry, manager);
        }

        return {
          date: session.date,
          session_id: session.id,
          version: session.version,
          records: responseRecords,
        };
      });
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505'
      ) {
        throw new ConflictException({
          message: 'This day was just created by another request',
          details: { code: 'STAFF_ATTENDANCE_SESSION_RACE' },
        });
      }
      throw err;
    }
  }
}
