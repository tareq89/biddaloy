import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import {
  AttendanceSource,
  AttendanceStatus,
  AuditAction,
  Permission,
  roleHasPermission,
} from '@biddaloy/shared';
import { StaffAttendanceSession } from './entities/staff-attendance-session.entity';
import { StaffAttendanceRecord } from './entities/staff-attendance-record.entity';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { AuditService, RecordAuditEntryInput } from '../audit/audit.service';
import { SchoolsService } from '../schools/schools.service';
import {
  daysBetween,
  localToday,
  resolveAttendancePolicy,
} from '../attendance/attendance-policy.util';
import {
  PutStaffAttendanceRegisterDto,
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
  ) {}

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

    try {
      return await this.dataSource.transaction(async (manager) => {
        const sessionRepo = manager.getRepository(StaffAttendanceSession);
        const recordRepo = manager.getRepository(StaffAttendanceRecord);
        const staffProfileRepo = manager.getRepository(StaffProfile);

        const settings = await this.schoolsService.getResolvedSettings(tenantId);
        const policy = resolveAttendancePolicy(settings);
        const timezone = settings.region?.timezone ?? 'UTC';
        const today = localToday(timezone);

        // Pessimistic lock: two concurrent PUTs for the same day must
        // serialize, matching `AttendanceService.putRegister`'s reasoning.
        let session = await sessionRepo.findOne({
          where: { tenant_id: tenantId, date: dto.date },
          lock: { mode: 'pessimistic_write' },
        });

        const isNewSession = !session;
        const hasCorrect = roleHasPermission(role, Permission.STAFF_ATTENDANCE_MARK);
        const age = daysBetween(dto.date, today);
        if (session && age > policy.correctionWindowDays) {
          if (!hasCorrect) {
            throw new ForbiddenException({
              message: 'This day is outside the correction window',
              details: { code: 'STAFF_ATTENDANCE_WINDOW_CLOSED' },
            });
          }
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
                where: { tenant_id: tenantId },
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
