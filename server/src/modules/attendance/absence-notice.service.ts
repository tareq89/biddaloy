import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import {
  AttendanceSessionState,
  AttendanceStatus,
  AuditAction,
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  ReminderBatchStatus,
} from '@biddaloy/shared';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { ReminderBatch } from '../communications/entities/reminder-batch.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { recordBatchOutcome } from '../communications/reminder-batch-counters';
import {
  addressForMedium,
  DISPATCHABLE_MEDIA,
  resolveReminderAudience,
} from '../communications/reminder-recipients.util';
import {
  joinStudentNames,
  renderReminderTemplate,
  ReminderTemplateVars,
} from '../communications/reminder-template.util';
import { AuditService } from '../audit/audit.service';
import { SchoolsService } from '../schools/schools.service';
import {
  AbsenceNoticePreviewResponseDto,
  AbsenceNoticeSendResponseDto,
} from './dto/absence-notice.dto';

/**
 * Mirrors `communications/reminders.service.ts`'s `SkipReason` shape and
 * exact string values so `guardian_notifications_disabled` etc. mean the
 * same thing everywhere a skip reason is logged, but is declared locally
 * rather than imported — this module's skip vocabulary is a subset (no
 * `NO_OPEN_DUES`, no `MEDIUM_NOT_ALLOWED`; absence notices are never
 * medium-restricted by the caller) and the two are free to diverge later
 * without one file's changes leaking into the other's contract.
 */
export const AbsenceNoticeSkipReason = {
  NO_GUARDIANS: 'no_guardians',
  NOTIFICATIONS_DISABLED: 'guardian_notifications_disabled',
  NO_AUTOMATED_PROVIDER: 'preferred_medium_has_no_automated_provider',
  MISSING_ADDRESS: 'guardian_has_no_address_for_preferred_medium',
} as const;

export interface AbsenceSkippedRecipient {
  student_id: string;
  guardian_id: string | null;
  reason: string;
}

/** One guardian, grouped across every one of their children absent that
 * day — "one guardian with 3 absent children gets exactly one message
 * naming all 3", not three separate sends. */
export interface AbsenceResolvedRecipient {
  guardian: Guardian;
  medium: CommunicationMedium;
  address: string;
  students: Student[];
  vars: ReminderTemplateVars;
}

interface AbsenceRecipientResolution {
  session: AttendanceSession | null;
  className: string;
  sectionName: string;
  schoolName: string;
  recipients: AbsenceResolvedRecipient[];
  skipped: AbsenceSkippedRecipient[];
}

/** Kept short and placeholder-only — SMS segments cost money, per the
 * `sms-segment-counter.tsx` convention the fee-reminder composer follows.
 * Not yet tenant-overridable: `AttendancePolicySettings` has no message-
 * template field, and adding one is a schema change this ticket's touched
 * files don't include (see the implementation report for this divergence
 * from the plan's "next to tenant-settings defaults" suggestion). */
export const DEFAULT_ABSENCE_NOTICE_TEMPLATE =
  'Dear Guardian, {{student_names}} was marked absent today ({{date}}) in ' +
  '{{section_name}} at {{school_name}}. If this is a mistake, please contact the school.';

/**
 * Builds and sends the guardian-facing "your child was marked absent today"
 * notice for one section's finalized register. [9.8]
 *
 * Recipient resolution (`buildRecipients`) is pure and read-only, shared by
 * both the preview route and `sendAbsenceNotices` — a sender must see
 * exactly what a send would do, never a different resolution. Reuses
 * `reminder-recipients.util.ts`'s guardian-selection/opt-out/medium rules
 * as-is (they take `Guardian[]` and know nothing about fees), but this
 * module's own recipient shape and skip vocabulary, because the fee path's
 * `resolveRecipients` filters on open dues — nothing here fits it.
 */
@Injectable()
export class AbsenceNoticeService {
  private readonly logger = new Logger(AbsenceNoticeService.name);

  constructor(
    @InjectRepository(AttendanceSession)
    private readonly sessionRepo: Repository<AttendanceSession>,
    @InjectRepository(AttendanceRecord)
    private readonly recordRepo: Repository<AttendanceRecord>,
    @InjectRepository(ClassSection)
    private readonly sectionRepo: Repository<ClassSection>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(ReminderBatch)
    private readonly batchRepo: Repository<ReminderBatch>,
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectQueue(COMMUNICATIONS_QUEUE)
    private readonly queue: Queue,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly schoolsService: SchoolsService,
  ) {}

  // ---------------------------------------------------------------------
  // Recipient resolution — no writes, no sending.
  // ---------------------------------------------------------------------

  async buildRecipients(params: {
    tenantId: string;
    sectionId: string;
    date: string;
  }): Promise<AbsenceRecipientResolution> {
    const { tenantId, sectionId, date } = params;
    const { className, sectionName, schoolName } = await this.loadSectionContext(
      tenantId,
      sectionId,
    );

    const session = await this.sessionRepo.findOne({
      where: { tenant_id: tenantId, section_id: sectionId, date, period_no: IsNull() },
    });
    if (!session || session.state !== AttendanceSessionState.FINALIZED) {
      return { session, className, sectionName, schoolName, recipients: [], skipped: [] };
    }

    const { recipients, skipped } = await this.resolveAbsentees(
      this.dataSource.manager,
      tenantId,
      session,
      sectionName,
      schoolName,
    );
    return { session, className, sectionName, schoolName, recipients, skipped };
  }

  /**
   * Walks a finalized session's `ABSENT` records → students → guardians,
   * grouping by guardian so one guardian with several absent children
   * produces one recipient. `LATE` and `LEAVE` never appear here — an
   * approved leave or a late arrival is not an absence, and texting a
   * guardian about one destroys trust in the channel for real absences.
   *
   * A guardian who cannot be reached at all (no automated provider for
   * their preferred medium, or no address for it) is skipped once, not
   * once per absent child — the reason doesn't change on a second student,
   * and a repeated skip row would just double-count the same guardian in
   * `skipped_count`.
   */
  private async resolveAbsentees(
    manager: EntityManager,
    tenantId: string,
    session: AttendanceSession,
    sectionName: string,
    schoolName: string,
  ): Promise<{ recipients: AbsenceResolvedRecipient[]; skipped: AbsenceSkippedRecipient[] }> {
    const recordRepo = manager.getRepository(AttendanceRecord);
    const studentRepo = manager.getRepository(Student);

    const absentRecords = await recordRepo.find({
      where: { session_id: session.id, tenant_id: tenantId, status: AttendanceStatus.ABSENT },
    });
    if (absentRecords.length === 0) {
      return { recipients: [], skipped: [] };
    }

    const studentIds = absentRecords.map((r) => r.student_id);
    const students = await studentRepo.find({
      where: { id: In(studentIds), tenant_id: tenantId },
      relations: ['guardians'],
    });

    const skipped: AbsenceSkippedRecipient[] = [];
    const byGuardian = new Map<
      string,
      { guardian: Guardian; medium: CommunicationMedium; address: string; students: Student[] }
    >();
    const unreachableGuardianIds = new Set<string>();

    for (const student of students) {
      const linked = student.guardians ?? [];
      if (linked.length === 0) {
        skipped.push({
          student_id: student.id,
          guardian_id: null,
          reason: AbsenceNoticeSkipReason.NO_GUARDIANS,
        });
        continue;
      }

      const { guardians, skippedOptOut } = resolveReminderAudience(linked);
      for (const guardian of skippedOptOut) {
        skipped.push({
          student_id: student.id,
          guardian_id: guardian.id,
          reason: AbsenceNoticeSkipReason.NOTIFICATIONS_DISABLED,
        });
      }

      for (const guardian of guardians) {
        if (unreachableGuardianIds.has(guardian.id)) continue;

        let entry = byGuardian.get(guardian.id);
        if (!entry) {
          const medium = guardian.preferred_communication;
          if (!DISPATCHABLE_MEDIA.includes(medium)) {
            skipped.push({
              student_id: student.id,
              guardian_id: guardian.id,
              reason: AbsenceNoticeSkipReason.NO_AUTOMATED_PROVIDER,
            });
            unreachableGuardianIds.add(guardian.id);
            continue;
          }
          const address = addressForMedium(guardian, medium);
          if (!address) {
            skipped.push({
              student_id: student.id,
              guardian_id: guardian.id,
              reason: AbsenceNoticeSkipReason.MISSING_ADDRESS,
            });
            unreachableGuardianIds.add(guardian.id);
            continue;
          }
          entry = { guardian, medium, address, students: [] };
          byGuardian.set(guardian.id, entry);
        }
        entry.students.push(student);
      }
    }

    const recipients: AbsenceResolvedRecipient[] = [...byGuardian.values()].map((entry) => ({
      guardian: entry.guardian,
      medium: entry.medium,
      address: entry.address,
      students: entry.students,
      vars: {
        student_names: joinStudentNames(
          entry.students.map((s) => s.full_name),
          'en-US',
        ),
        date: session.date,
        section_name: sectionName,
        school_name: schoolName,
      },
    }));

    return { recipients, skipped };
  }

  private async loadSectionContext(
    tenantId: string,
    sectionId: string,
  ): Promise<{ className: string; sectionName: string; schoolName: string }> {
    const section = await this.sectionRepo.findOne({
      where: { id: sectionId, tenant_id: tenantId },
      relations: ['class', 'tenant'],
    });
    // `findOne` excludes soft-deleted sections by default, but the
    // scheduler's own session query does not check the section's
    // deleted_at — a finalized session can still reference one that was
    // since removed. Silently falling back to empty names would let a
    // batch and SMS go out naming no section at all; fail loudly instead.
    if (!section) {
      throw new NotFoundException(`Section "${sectionId}" not found`);
    }
    return {
      className: section.class?.name ?? '',
      sectionName: section.section_name,
      schoolName: section.tenant?.name ?? '',
    };
  }

  // ---------------------------------------------------------------------
  // Preview — resolves exactly what `sendAbsenceNotices` would do, sends
  // nothing.
  // ---------------------------------------------------------------------

  async previewAbsenceNotice(params: {
    tenantId: string;
    sectionId: string;
    date: string;
    userId: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<AbsenceNoticePreviewResponseDto> {
    const { tenantId, sectionId, date, userId, ip, userAgent } = params;
    const { session, recipients, skipped } = await this.buildRecipients({
      tenantId,
      sectionId,
      date,
    });

    await this.auditService.record({
      action: AuditAction.REMINDER_PREVIEWED,
      entity_type: 'AbsenceNoticePreview',
      entity_id: session?.id ?? null,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: ip,
      user_agent: userAgent,
      new_values: {
        section_id: sectionId,
        date,
        recipient_count: recipients.length,
        skipped_count: skipped.length,
      },
    });

    return {
      session_found: !!session,
      finalized: session?.state === AttendanceSessionState.FINALIZED,
      already_notified: !!session?.notified_at,
      recipients: recipients.map((r) => ({
        guardian_id: r.guardian.id,
        guardian_name: r.guardian.full_name,
        medium: r.medium,
        address: r.address,
        student_ids: r.students.map((s) => s.id),
        student_names: r.students.map((s) => s.full_name),
        message_body: renderReminderTemplate(DEFAULT_ABSENCE_NOTICE_TEMPLATE, r.vars),
      })),
      skipped,
      message_preview: DEFAULT_ABSENCE_NOTICE_TEMPLATE,
    };
  }

  // ---------------------------------------------------------------------
  // Send — the only path that actually queues messages and marks a session
  // notified. Called from three places: the manual `send` route, [9.8]'s
  // scheduler sweep, and `AttendanceService.putRegister` right after a
  // teacher-initiated `finalize: true`.
  // ---------------------------------------------------------------------

  async sendAbsenceNotices(params: {
    tenantId: string;
    sectionId: string;
    date: string;
    initiatedByUserId: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<AbsenceNoticeSendResponseDto> {
    const { tenantId, sectionId, date, initiatedByUserId, ip = null, userAgent = null } = params;

    const { className, sectionName, schoolName } = await this.loadSectionContext(
      tenantId,
      sectionId,
    );

    // Everything that decides *whether* to send, plus the batch row and the
    // `notified_at` stamp, happens in one transaction under a row lock — the
    // idempotency guarantee is the `FOR UPDATE` read below, not an
    // in-memory check, so two concurrent callers (the scheduler and a
    // manual send, say) can never both queue a batch for the same session.
    const outcome = await this.dataSource.transaction(async (manager) => {
      const sessionRepo = manager.getRepository(AttendanceSession);
      const session = await sessionRepo.findOne({
        where: { tenant_id: tenantId, section_id: sectionId, date, period_no: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session) {
        return { batch: null, recipients: [], skipped_reason: 'no_session' as const };
      }
      if (session.state !== AttendanceSessionState.FINALIZED) {
        return { batch: null, recipients: [], skipped_reason: 'not_finalized' as const };
      }
      if (session.notified_at) {
        return { batch: null, recipients: [], skipped_reason: 'already_notified' as const };
      }

      const { recipients, skipped } = await this.resolveAbsentees(
        manager,
        tenantId,
        session,
        sectionName,
        schoolName,
      );

      const batchRepo = manager.getRepository(ReminderBatch);
      const batch = await batchRepo.save(
        batchRepo.create({
          tenant_id: tenantId,
          batch_name: `Absence notice — ${className} ${sectionName} — ${date}`.slice(0, 200),
          status:
            recipients.length === 0
              ? ReminderBatchStatus.COMPLETED
              : ReminderBatchStatus.PROCESSING,
          total_recipients: recipients.length,
          message_template: DEFAULT_ABSENCE_NOTICE_TEMPLATE,
          initiated_by_user_id: initiatedByUserId,
          filters_applied: { purpose: 'ABSENCE_NOTICE', section_id: sectionId, date, skipped },
        }),
      );

      session.notified_at = new Date();
      await sessionRepo.save(session);

      return { batch, recipients, skipped_reason: null };
    });

    if (outcome.batch) {
      await this.auditService.record({
        action: AuditAction.REMINDER_SENT,
        entity_type: 'ReminderBatch',
        entity_id: outcome.batch.id,
        tenant_id: tenantId,
        performed_by_user_id: initiatedByUserId,
        ip_address: ip,
        user_agent: userAgent,
        new_values: {
          section_id: sectionId,
          date,
          recipient_count: outcome.recipients.length,
        },
      });

      // Enqueueing happens after the transaction has committed — a job
      // that fails to enqueue must never roll back the batch row or the
      // `notified_at` stamp; the batch stays visible in Reminder History
      // recording that a send was attempted, which is recoverable, unlike
      // silently losing the fact a batch happened at all.
      await this.queueRecipients(outcome.batch, outcome.recipients, tenantId, initiatedByUserId);
    }

    return {
      batch_id: outcome.batch?.id ?? null,
      status: outcome.batch?.status ?? null,
      total_recipients: outcome.recipients.length,
      skipped_reason: outcome.skipped_reason,
    };
  }

  /** Mirrors `BulkReminderService.queueRecipients` — one `CommunicationLog`
   * row and one queue job per guardian, same worker, same retry policy. A
   * recipient here can name several students, so unlike the fee path's
   * one-student-per-log, `metadata.student_ids` carries the full list and
   * `student_id` is only the first — enough for the existing per-log
   * drill-down to link back to a real student without a schema change. */
  private async queueRecipients(
    batch: ReminderBatch,
    recipients: AbsenceResolvedRecipient[],
    tenantId: string,
    userId: string,
  ): Promise<void> {
    for (const recipient of recipients) {
      let log: CommunicationLog;
      try {
        log = await this.logRepo.save(
          this.logRepo.create({
            tenant_id: tenantId,
            reminder_batch_id: batch.id,
            medium: recipient.medium,
            recipient_address: recipient.address,
            recipient_name: recipient.guardian.full_name,
            message_body: renderReminderTemplate(DEFAULT_ABSENCE_NOTICE_TEMPLATE, recipient.vars),
            subject: recipient.medium === CommunicationMedium.EMAIL ? 'Absence Notice' : null,
            student_id: recipient.students[0]?.id ?? null,
            guardian_id: recipient.guardian.id,
            sent_by_user_id: userId,
            status: CommunicationStatus.QUEUED,
            trigger: CommunicationTrigger.AUTOMATED,
            metadata: { student_ids: recipient.students.map((s) => s.id) },
          }),
        );
      } catch (error) {
        // Unlike the `queue.add` failure below, there is no log row to
        // mark FAILED — it never got created. A transient insert error
        // (connection drop, deadlock, a constraint violation) must not
        // abort every *remaining* recipient in this batch, so record the
        // outcome and move on rather than letting the exception propagate.
        this.logger.warn(
          `Failed to create CommunicationLog for batch ${batch.id}, guardian ${recipient.guardian.id}: ${String(error)}`,
        );
        await recordBatchOutcome(this.logRepo.manager, batch.id, 'failure');
        continue;
      }

      try {
        await this.queue.add('send', { logId: log.id });
      } catch (error) {
        this.logger.warn(
          `Failed to enqueue absence-notice log ${log.id} for batch ${batch.id}: ${String(error)}`,
        );
        log.status = CommunicationStatus.FAILED;
        log.metadata = { ...log.metadata, error: 'Failed to enqueue for delivery' };
        await this.logRepo.manager.transaction(async (manager) => {
          await manager.save(log);
          await recordBatchOutcome(manager, batch.id, 'failure');
        });
      }
    }
  }
}
