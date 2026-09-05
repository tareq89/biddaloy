import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, QueryFailedError, Repository } from 'typeorm';
import { AttendanceEventDirection, AttendanceSource, AuditAction } from '@biddaloy/shared';
import { AttendanceDevice } from '../entities/attendance-device.entity';
import { AttendanceDeviceEvent } from '../entities/attendance-device-event.entity';
import { AttendanceSession } from '../entities/attendance-session.entity';
import { AttendanceRecord } from '../entities/attendance-record.entity';
import { Student } from '../../students/entities/student.entity';
import { SchoolsService } from '../../schools/schools.service';
import { AuditService } from '../../audit/audit.service';
import {
  classifyCheckIn,
  daysBetween,
  localDate,
  localToday,
  resolveAttendancePolicy,
} from '../attendance-policy.util';
import {
  DeviceEventBatchResponseDto,
  DeviceEventDto,
  DeviceEventResultDto,
  DeviceHeartbeatResponseDto,
  DeviceRosterEntryDto,
} from '../dto/device.dto';

const CLOCK_WINDOW_DAYS = 2;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof QueryFailedError && (err as unknown as { code?: string }).code === '23505';
}

/**
 * Turns a batch of raw device scans into attendance marks. Each event is
 * handled in its own transaction — a batch is not atomic, since the device
 * has no way to work out which single event we objected to and would just
 * retry the whole batch forever if one bad event failed the rest.
 */
@Injectable()
export class DeviceEventsService {
  private readonly logger = new Logger(DeviceEventsService.name);

  constructor(
    @InjectRepository(AttendanceDevice)
    private readonly deviceRepo: Repository<AttendanceDevice>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly schoolsService: SchoolsService,
    private readonly auditService: AuditService,
  ) {}

  // ---------------------------------------------------------------------
  // GET /attendance/devices/me/roster
  // ---------------------------------------------------------------------

  /**
   * 403 unless `device.roster_access` is true. When the device is bound to
   * a section, that is the only section it may read. Response is exactly
   * these five fields — built by explicitly listing them, never by
   * returning the entity and deleting keys, which would leak whatever
   * field gets added to `Student` next year.
   */
  async getRoster(device: AttendanceDevice, sectionId?: string): Promise<DeviceRosterEntryDto[]> {
    if (!device.roster_access) {
      throw new ForbiddenException('This device is not permitted to read the roster');
    }

    const effectiveSectionId = device.section_id ?? sectionId;
    if (device.section_id && sectionId && sectionId !== device.section_id) {
      throw new ForbiddenException('This device may only read its own bound section');
    }
    if (!effectiveSectionId) {
      throw new ForbiddenException('section_id is required for a device with no bound section');
    }

    const students = await this.studentRepo.find({
      where: {
        tenant_id: device.tenant_id,
        class_section_id: effectiveSectionId,
        deleted_at: IsNull(),
      },
      order: { roll_number: 'ASC' },
    });

    return students.map((s) => ({
      student_id: s.id,
      registration_number: s.registration_number,
      roll_number: s.roll_number,
      full_name: s.full_name,
      section_id: effectiveSectionId,
    }));
  }

  // ---------------------------------------------------------------------
  // POST /attendance/devices/me/heartbeat
  // ---------------------------------------------------------------------

  async heartbeat(device: AttendanceDevice): Promise<DeviceHeartbeatResponseDto> {
    const settings = await this.schoolsService.getResolvedSettings(device.tenant_id);
    const policy = resolveAttendancePolicy(settings);
    const timezone = settings.region?.timezone ?? 'UTC';

    await this.deviceRepo.update(device.id, { last_seen_at: new Date() });

    return {
      server_time: new Date().toISOString(),
      tenant_timezone: timezone,
      policy: { late_after: policy.lateAfter, absent_after: policy.absentAfter },
    };
  }

  async ingest(
    device: AttendanceDevice,
    events: DeviceEventDto[],
  ): Promise<DeviceEventBatchResponseDto> {
    const results: DeviceEventResultDto[] = [];
    let accepted = 0;
    let duplicate = 0;
    let failed = 0;

    for (const event of events) {
      let result: DeviceEventResultDto;
      try {
        result = await this.ingestOne(device, event);
      } catch (err) {
        this.logger.error(
          `Device event ingest failed for device ${device.id}, event ${event.device_event_id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        result = {
          device_event_id: event.device_event_id,
          outcome: 'rejected',
          reason: 'internal_error',
        };
      }

      results.push(result);
      if (result.outcome === 'accepted') accepted += 1;
      else if (result.outcome === 'duplicate') duplicate += 1;
      else failed += 1;
    }

    // Once per batch, not per event — see this service's docstring.
    await this.deviceRepo.update(device.id, { last_seen_at: new Date() });

    // One audit row per batch (`attendance_device_events` is already the
    // per-event trail) — a turnstile would otherwise write thousands of
    // audit rows a day.
    await this.auditService.record({
      action: AuditAction.UPDATE,
      entity_type: 'AttendanceSession',
      entity_id: null,
      tenant_id: device.tenant_id,
      performed_by_user_id: null,
      old_values: null,
      new_values: {
        source: AttendanceSource.DEVICE,
        device_id: device.id,
        accepted,
        duplicate,
        failed,
      },
    });

    return { results, accepted, duplicate, failed };
  }

  private async ingestOne(
    device: AttendanceDevice,
    event: DeviceEventDto,
  ): Promise<DeviceEventResultDto> {
    const settings = await this.schoolsService.getResolvedSettings(device.tenant_id);
    const policy = resolveAttendancePolicy(settings);
    const timezone = settings.region?.timezone ?? 'UTC';
    const occurredAt = new Date(event.occurred_at);
    const eventDate = localDate(occurredAt, timezone);

    return this.dataSource.transaction(async (manager) => {
      const eventRepo = manager.getRepository(AttendanceDeviceEvent);

      // 1. Idempotency: the unique index on (device_id, device_event_id)
      // is the guarantee. Catching the violation rather than pre-checking
      // with a SELECT avoids a race between two concurrent batches that
      // would otherwise let both through.
      let eventRow: AttendanceDeviceEvent;
      try {
        eventRow = await eventRepo.save(
          eventRepo.create({
            tenant_id: device.tenant_id,
            device_id: device.id,
            device_event_id: event.device_event_id,
            external_ref: event.external_ref ?? null,
            student_id: event.student_id ?? null,
            occurred_at: occurredAt,
            direction: event.direction,
            // Placeholder — overwritten below once the real outcome is
            // known. `outcome` is NOT NULL, so the initial insert (which
            // is what the unique index actually guards) needs some value.
            outcome: 'accepted',
            raw: event as unknown as Record<string, unknown>,
          }),
        );
      } catch (err) {
        if (isUniqueViolation(err)) {
          return { device_event_id: event.device_event_id, outcome: 'duplicate' };
        }
        throw err;
      }

      // 2. Resolve the student. Exactly one of student_id/external_ref must
      // be given — the DTO documents this as an either/or, but nothing
      // enforces it there, so a malformed event with both set must not
      // silently resolve by student_id and ignore external_ref.
      const hasStudentId = event.student_id !== undefined && event.student_id !== null;
      const hasExternalRef = event.external_ref !== undefined && event.external_ref !== null;
      if (hasStudentId === hasExternalRef) {
        await eventRepo.update(eventRow.id, { outcome: 'unknown_student' });
        return { device_event_id: event.device_event_id, outcome: 'unknown_student' };
      }

      const student = await this.resolveStudent(manager, device.tenant_id, event);
      if (!student) {
        await eventRepo.update(eventRow.id, { outcome: 'unknown_student' });
        return { device_event_id: event.device_event_id, outcome: 'unknown_student' };
      }

      // 3. Clock-skew window. A scanner whose clock is a year off must not
      // be able to rewrite history.
      if (this.isOutOfWindow(eventDate, timezone)) {
        await eventRepo.update(eventRow.id, { outcome: 'out_of_window', student_id: student.id });
        return { device_event_id: event.device_event_id, outcome: 'out_of_window' };
      }

      if (device.section_id && student.class_section_id !== device.section_id) {
        await eventRepo.update(eventRow.id, { outcome: 'rejected', student_id: student.id });
        return {
          device_event_id: event.device_event_id,
          outcome: 'rejected',
          reason: 'section_mismatch',
        };
      }

      if (event.direction === AttendanceEventDirection.OUT) {
        return this.handleCheckOut(
          manager,
          eventRepo,
          eventRow,
          device,
          student,
          eventDate,
          occurredAt,
        );
      }
      return this.handleCheckIn(
        manager,
        eventRepo,
        eventRow,
        device,
        student,
        eventDate,
        occurredAt,
        policy,
        timezone,
      );
    });
  }

  private isOutOfWindow(eventDateIso: string, timezone: string): boolean {
    return Math.abs(daysBetween(eventDateIso, localToday(timezone))) > CLOCK_WINDOW_DAYS;
  }

  private async resolveStudent(
    manager: EntityManager,
    tenantId: string,
    event: DeviceEventDto,
  ): Promise<Student | null> {
    const studentRepo = manager.getRepository(Student);
    if (event.student_id) {
      return studentRepo.findOne({
        where: { id: event.student_id, tenant_id: tenantId, deleted_at: IsNull() },
      });
    }
    if (event.external_ref) {
      return studentRepo.findOne({
        where: {
          registration_number: event.external_ref,
          tenant_id: tenantId,
          deleted_at: IsNull(),
        },
      });
    }
    return null;
  }

  private async handleCheckOut(
    manager: EntityManager,
    eventRepo: Repository<AttendanceDeviceEvent>,
    eventRow: AttendanceDeviceEvent,
    device: AttendanceDevice,
    student: Student,
    dateIso: string,
    occurredAt: Date,
  ): Promise<DeviceEventResultDto> {
    const recordRepo = manager.getRepository(AttendanceRecord);
    const record = await recordRepo.findOne({
      where: { tenant_id: device.tenant_id, student_id: student.id, date: dateIso },
    });

    if (!record) {
      await eventRepo.update(eventRow.id, { outcome: 'rejected', student_id: student.id });
      return {
        device_event_id: eventRow.device_event_id,
        outcome: 'rejected',
        reason: 'no_check_in',
      };
    }

    if (record.check_out_at === null) {
      record.check_out_at = occurredAt;
      await recordRepo.save(record);
    }

    await eventRepo.update(eventRow.id, {
      outcome: 'accepted',
      student_id: student.id,
      record_id: record.id,
    });
    return {
      device_event_id: eventRow.device_event_id,
      outcome: 'accepted',
      student_id: student.id,
      status: record.status,
      minutes_late: record.minutes_late,
    };
  }

  private async handleCheckIn(
    manager: EntityManager,
    eventRepo: Repository<AttendanceDeviceEvent>,
    eventRow: AttendanceDeviceEvent,
    device: AttendanceDevice,
    student: Student,
    dateIso: string,
    occurredAt: Date,
    policy: ReturnType<typeof resolveAttendancePolicy>,
    timezone: string,
  ): Promise<DeviceEventResultDto> {
    const sessionRepo = manager.getRepository(AttendanceSession);
    const recordRepo = manager.getRepository(AttendanceRecord);
    const sectionId = device.section_id ?? student.class_section_id;

    let session = await sessionRepo.findOne({
      where: {
        tenant_id: device.tenant_id,
        section_id: sectionId,
        date: dateIso,
        period_no: IsNull(),
      },
    });
    if (!session) {
      try {
        session = await sessionRepo.save(
          sessionRepo.create({
            tenant_id: device.tenant_id,
            section_id: sectionId,
            date: dateIso,
            period_no: null,
            source: AttendanceSource.DEVICE,
          }),
        );
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Two concurrent device batches raced to create the same day's
        // whole-day session — the loser re-reads what the winner created.
        session = await sessionRepo.findOneOrFail({
          where: {
            tenant_id: device.tenant_id,
            section_id: sectionId,
            date: dateIso,
            period_no: IsNull(),
          },
        });
      }
    }

    let record = await recordRepo.findOne({
      where: { session_id: session.id, student_id: student.id },
    });
    let outcome: string;
    let versionBumped = false;

    if (!record) {
      const classification = classifyCheckIn(occurredAt, dateIso, policy, timezone);
      record = await recordRepo.save(
        recordRepo.create({
          tenant_id: device.tenant_id,
          session_id: session.id,
          student_id: student.id,
          date: dateIso,
          status: classification.status,
          minutes_late: classification.minutesLate,
          check_in_at: occurredAt,
          source: AttendanceSource.DEVICE,
          device_id: device.id,
        }),
      );
      outcome = 'accepted';
      versionBumped = true;
    } else if (record.source === AttendanceSource.TEACHER) {
      // Contract #4: teacher authority beats device authority. A device
      // may only fill fields the teacher left empty — never touch `status`.
      outcome = 'skipped_teacher_marked';
      if (record.check_in_at === null) {
        record.check_in_at = occurredAt;
        await recordRepo.save(record);
        versionBumped = true;
      }
    } else if (occurredAt.getTime() < (record.check_in_at?.getTime() ?? Infinity)) {
      // Keep the earliest check-in among repeated device scans.
      const classification = classifyCheckIn(occurredAt, dateIso, policy, timezone);
      record.check_in_at = occurredAt;
      record.status = classification.status;
      record.minutes_late = classification.minutesLate;
      record.device_id = device.id;
      await recordRepo.save(record);
      outcome = 'accepted';
      versionBumped = true;
    } else {
      outcome = 'duplicate';
    }

    if (versionBumped) {
      // Bumps the session's version explicitly so a teacher's open marking
      // screen finds out on its next write (the same conflict path [9.3]
      // uses).
      await sessionRepo.increment({ id: session.id }, 'version', 1);
    }

    await eventRepo.update(eventRow.id, {
      outcome,
      student_id: student.id,
      record_id: record.id,
    });

    return {
      device_event_id: eventRow.device_event_id,
      outcome,
      student_id: student.id,
      status: record.status,
      minutes_late: record.minutes_late,
    };
  }
}
