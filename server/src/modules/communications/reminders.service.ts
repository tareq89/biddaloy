import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { CommunicationLog } from './entities/communication-log.entity';
import { ReminderBatch } from './entities/reminder-batch.entity';
import { StudentService } from '../students/students.service';
import { FeeDuesService, StudentDueSnapshot } from '../fees/fee-dues.service';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import {
  SendBulkReminderDto,
  ReminderBatchResponseDto,
  SkippedRecipientDto,
  QueryReminderBatchesDto,
  ReminderBatchListResponseDto,
  ReminderBatchListItemDto,
  BulkReminderPreviewResponseDto,
  BulkPreviewStudentDto,
  QueryReminderBatchLogsDto,
  ReminderBatchLogListResponseDto,
  ReminderBatchLogDto,
} from './dto/reminders.dto';
import {
  findUnsupportedPlaceholders,
  renderReminderTemplate,
  formatDueAmount,
  formatDueMonth,
  ReminderTemplateVars,
  SUPPORTED_PLACEHOLDERS,
  isSupportedPlaceholder,
} from './reminder-template.util';
import { recordBatchOutcome } from './reminder-batch-counters';
import { COMMUNICATIONS_QUEUE } from './communications.constants';
import { normalizeSearchTerm } from '../../common/utils/normalize-search-term.util';
import { BN_COLLATION } from '../../common/constants/collation';
import {
  selectReminderGuardians,
  partitionByOptOut,
  resolveReminderAudience,
  addressForMedium,
  DISPATCHABLE_MEDIA,
} from './reminder-recipients.util';
import { resolveWhatsAppTemplate, whatsAppTemplateMetadata } from './whatsapp-template.util';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import {
  AuditAction,
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  ReminderBatchStatus,
} from '@biddaloy/shared';

// Re-exported so existing imports (this file's own spec, in particular)
// keep working — the shared #18 single-reminder flow needs these too, so
// they now live in reminder-recipients.util.ts.
export { selectReminderGuardians, partitionByOptOut, resolveReminderAudience, addressForMedium };

/**
 * Why a recipient was left out of a batch. Returned verbatim to the caller
 * and persisted in the batch's filters_applied, so "we sent 40 of 60" is
 * always accompanied by which 20 and why.
 */
export const SkipReason = {
  NO_OPEN_DUES: 'no_open_dues',
  NO_GUARDIANS: 'no_guardians',
  MEDIUM_NOT_ALLOWED: 'preferred_medium_not_in_requested_mediums',
  NO_AUTOMATED_PROVIDER: 'preferred_medium_has_no_automated_provider',
  MISSING_ADDRESS: 'guardian_has_no_address_for_preferred_medium',
  NOTIFICATIONS_DISABLED: 'guardian_notifications_disabled',
} as const;

export interface ResolvedRecipient {
  student: Student;
  guardian: Guardian;
  medium: CommunicationMedium;
  address: string;
  vars: ReminderTemplateVars;
}

@Injectable()
export class BulkReminderService {
  constructor(
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectRepository(ReminderBatch)
    private readonly batchRepo: Repository<ReminderBatch>,
    @InjectQueue(COMMUNICATIONS_QUEUE)
    private readonly queue: Queue,
    private readonly studentService: StudentService,
    private readonly feeDuesService: FeeDuesService,
    private readonly auditService: AuditService,
  ) {}

  async sendBulk(
    dto: SendBulkReminderDto,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<ReminderBatchResponseDto> {
    const { studentIds, recipients, skipped } = await this.validateAndResolve(dto, tenantId);

    const batch = await this.batchRepo.save(
      this.batchRepo.create({
        tenant_id: tenantId,
        batch_name: dto.batch_name || this.defaultBatchName(),
        // Nothing to dispatch is a finished batch, not a stuck one.
        status:
          recipients.length === 0 ? ReminderBatchStatus.COMPLETED : ReminderBatchStatus.PROCESSING,
        total_recipients: recipients.length,
        message_template: dto.message_template,
        initiated_by_user_id: userId,
        filters_applied: {
          student_ids: studentIds,
          mediums: dto.mediums ?? null,
          // Persisted so a retry can reproduce this batch exactly. Without
          // them, retrying an email-only batch would fan back out to every
          // preferred channel, and retrying a WhatsApp template batch would
          // become a freeform send Meta rejects outside its 24-hour window
          // — reproducing the very failure being retried.
          whatsapp_template_name: dto.whatsapp_template_name ?? null,
          whatsapp_template_language: dto.whatsapp_template_language ?? null,
          whatsapp_template_params: dto.whatsapp_template_params ?? null,
          skipped,
        },
      }),
    );

    const { queued, failed } = await this.queueRecipients(recipients, batch, dto, tenantId, userId);

    // One record per batch, not per recipient — a bulk send can fan out to
    // hundreds of guardians, and PAYMENT_RECEIVED/BULK_UPLOAD already set
    // the precedent of one audit row per user-initiated action. Queued/
    // failed are enqueue outcomes, not final delivery (that settles async,
    // later, via the worker) — but "attempted N, only M actually reached
    // the queue" is exactly what this record must not silently collapse
    // into a single "sent" count.
    await this.auditService.record({
      action: AuditAction.REMINDER_SENT,
      entity_type: 'ReminderBatch',
      entity_id: batch.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: {
        student_count: studentIds.length,
        recipient_count: recipients.length,
        queued_count: queued,
        failed_count: failed,
        skipped_count: skipped.length,
      },
    });

    // Re-read so the response reflects any failures the enqueue loop
    // recorded rather than the counts the batch was created with.
    const saved = await this.batchRepo.findOne({ where: { id: batch.id } });
    return this.toResponseDto(saved ?? batch, skipped);
  }

  async findBatch(id: string, tenantId: string): Promise<ReminderBatchResponseDto> {
    const batch = await this.batchRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!batch) {
      throw new NotFoundException(`Reminder batch with ID "${id}" not found`);
    }
    const skipped = (batch.filters_applied?.skipped as SkippedRecipientDto[] | undefined) ?? [];
    return this.toResponseDto(batch, skipped);
  }

  /**
   * Reminder History's data source: every batch this tenant ever sent,
   * newest first. Excludes each batch's skip list — see
   * ReminderBatchListItemDto for why.
   */
  async findBatches(
    query: QueryReminderBatchesDto,
    tenantId: string,
  ): Promise<ReminderBatchListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.batchRepo
      .createQueryBuilder('batch')
      .where('batch.tenant_id = :tenantId', { tenantId })
      // Exactly the columns toListItemDto maps. Without this, every row on
      // the page also drags back `message_template` (up to 2000 chars) and
      // the `filters_applied` jsonb — which holds the batch's whole
      // student_ids list *and* its skip list, potentially hundreds of
      // entries — only for them to be discarded here.
      .select([
        'batch.id',
        'batch.batch_name',
        'batch.status',
        'batch.total_recipients',
        'batch.successful_count',
        'batch.failed_count',
        'batch.created_at',
      ]);

    const search = normalizeSearchTerm(query.search);
    if (search) {
      qb.andWhere('batch.batch_name ILIKE :search', { search: `%${search}%` });
    }
    if (query.status) {
      qb.andWhere('batch.status = :status', { status: query.status });
    }
    if (query.from_date) {
      qb.andWhere('batch.created_at >= :fromDate', { fromDate: query.from_date });
    }
    if (query.to_date) {
      // A date-only value must include the whole day, matching the
      // pattern used elsewhere in this codebase for to_date filters
      // (e.g. AuditService.findAll).
      const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(query.to_date);
      const toDate = new Date(query.to_date);
      if (isDateOnly) {
        toDate.setUTCHours(23, 59, 59, 999);
      }
      qb.andWhere('batch.created_at <= :toDate', { toDate });
    }

    if (query.sort === 'batch_name') {
      qb.orderBy(`batch.batch_name COLLATE "${BN_COLLATION}"`, query.order === 'desc' ? 'DESC' : 'ASC');
    } else if (query.sort === 'total_recipients') {
      qb.orderBy('batch.total_recipients', query.order === 'asc' ? 'ASC' : 'DESC');
    } else {
      qb.orderBy('batch.created_at', query.order === 'asc' ? 'ASC' : 'DESC');
    }
    qb.addOrderBy('batch.id', 'DESC');

    const [batches, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: batches.map((batch) => this.toListItemDto(batch)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Exactly what sendBulk would deliver for this request, without doing
   * any of it — no batch row, no communication logs, no queue jobs. The
   * epic makes preview mandatory before send: the sender must see the
   * resolved recipients *and* the skipped ones (with reasons), because the
   * server's skip logic (dues, guardian preferences, missing addresses)
   * cannot be reproduced client-side.
   *
   * "Delivers" rather than "does": WhatsApp recipients are dispatched as a
   * Meta-approved template, not as the rendered `message_body`, so each
   * recipient also carries the resolved `whatsapp_template` — see
   * whatsapp-template.util.ts, which both this and the send path share so
   * the two can never disagree.
   *
   * One write does happen, deliberately: an audit record. Nothing is sent,
   * but the response names every guardian, channel and contact address
   * behind the filter, so who asked for it must leave a trace — same
   * reasoning as SETTINGS_TEST. Only counts are recorded, never the
   * resolved contact data itself.
   */
  async previewBulk(
    dto: SendBulkReminderDto,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<BulkReminderPreviewResponseDto> {
    const { studentIds, students, recipients, skipped } = await this.validateAndResolve(
      dto,
      tenantId,
    );

    const guardianNames = new Map<string, string>();
    const studentsById = new Map(students.map((s) => [s.id, s]));
    for (const student of students) {
      for (const guardian of student.guardians ?? []) {
        guardianNames.set(guardian.id, guardian.full_name);
      }
    }

    // Grouped per student, in request order — the review step reads
    // "for this student, these guardians get this exact message."
    const byStudent = new Map<string, BulkPreviewStudentDto>();
    for (const id of studentIds) {
      const student = studentsById.get(id);
      if (!student) continue; // unreachable: validateAndResolve 404s on missing ids
      byStudent.set(id, {
        student_id: id,
        student_name: student.full_name,
        recipients: [],
        skipped: [],
      });
    }

    for (const r of recipients) {
      byStudent.get(r.student.id)?.recipients.push({
        guardian_id: r.guardian.id,
        guardian_name: r.guardian.full_name,
        medium: r.medium,
        address: r.address,
        message_body: renderReminderTemplate(dto.message_template, r.vars),
        subject: r.medium === CommunicationMedium.EMAIL ? this.emailSubject(dto) : null,
        whatsapp_template: resolveWhatsAppTemplate(r.medium, r.vars, dto),
      });
    }

    for (const s of skipped) {
      byStudent.get(s.student_id)?.skipped.push({
        guardian_id: s.guardian_id,
        guardian_name: s.guardian_id ? (guardianNames.get(s.guardian_id) ?? null) : null,
        reason: s.reason,
      });
    }

    // Counts only — the point of the record is "this user resolved this
    // many contacts", not a second copy of the contacts themselves.
    await this.auditService.record({
      action: AuditAction.REMINDER_PREVIEWED,
      entity_type: 'ReminderBatchPreview',
      entity_id: null,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: {
        student_count: studentIds.length,
        recipient_count: recipients.length,
        skipped_count: skipped.length,
        mediums: dto.mediums ?? null,
      },
    });

    return {
      total_students: studentIds.length,
      recipients_count: recipients.length,
      skipped_count: skipped.length,
      students: [...byStudent.values()],
    };
  }

  /**
   * Per-recipient delivery status for one batch — the batch detail page's
   * table, and the source a retry composes its failed-students list from.
   * The batch is looked up first (tenant-scoped) so a cross-tenant batch id
   * 404s rather than returning an empty page indistinguishable from a
   * batch with no logs.
   */
  async findBatchLogs(
    id: string,
    query: QueryReminderBatchLogsDto,
    tenantId: string,
  ): Promise<ReminderBatchLogListResponseDto> {
    const batch = await this.batchRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!batch) {
      throw new NotFoundException(`Reminder batch with ID "${id}" not found`);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const [logs, total] = await this.logRepo.findAndCount({
      where: { reminder_batch_id: id, tenant_id: tenantId },
      order: { created_at: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: logs.map((log) => this.toBatchLogDto(log)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * The request-shaped half shared by previewBulk and sendBulk: template
   * and WhatsApp-param validation, id dedupe, tenant-scoped batch loads
   * (one query for students+guardians, one for due snapshots — never one
   * per student; input is capped at 500), and recipient resolution.
   * Shared so preview can never disagree with what send would then do.
   */
  private async validateAndResolve(
    dto: SendBulkReminderDto,
    tenantId: string,
  ): Promise<{
    studentIds: string[];
    students: Student[];
    recipients: ResolvedRecipient[];
    skipped: SkippedRecipientDto[];
  }> {
    const unsupported = findUnsupportedPlaceholders(dto.message_template);
    if (unsupported.length > 0) {
      throw new BadRequestException(
        `Unsupported template placeholder(s): ${unsupported.join(', ')}. ` +
          `Supported: ${SUPPORTED_PLACEHOLDERS.join(', ')}`,
      );
    }
    this.validateWhatsAppParams(dto);

    // A duplicated ID would otherwise send the same guardian the same
    // reminder twice and inflate total_recipients.
    const studentIds = [...new Set(dto.student_ids)];

    const students = await this.studentService.findManyWithGuardians(studentIds, tenantId);
    const found = new Set(students.map((s) => s.id));
    const missing = studentIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(`Student(s) not found: ${missing.join(', ')}`);
    }

    const dueSnapshots = await this.feeDuesService.getDueSnapshots(studentIds, tenantId);

    const skipped: SkippedRecipientDto[] = [];
    const recipients = this.resolveRecipients(students, dueSnapshots, dto, skipped);

    return { studentIds, students, recipients, skipped };
  }

  /**
   * Walks students → guardians → a concrete (medium, address) pair, pushing
   * anything undeliverable onto `skipped` instead of queueing a send that
   * cannot succeed.
   */
  private resolveRecipients(
    students: Student[],
    dueSnapshots: Map<string, StudentDueSnapshot>,
    dto: SendBulkReminderDto,
    skipped: SkippedRecipientDto[],
  ): ResolvedRecipient[] {
    const allowed = dto.mediums && dto.mediums.length > 0 ? new Set(dto.mediums) : null;
    const recipients: ResolvedRecipient[] = [];

    for (const student of students) {
      const snapshot = dueSnapshots.get(student.id);
      if (!snapshot) {
        // No open fee means there is nothing to remind about — a reminder
        // reading "you owe 0.00" is worse than no reminder.
        skipped.push({
          student_id: student.id,
          guardian_id: null,
          reason: SkipReason.NO_OPEN_DUES,
        });
        continue;
      }

      const linked = student.guardians ?? [];
      if (linked.length === 0) {
        skipped.push({
          student_id: student.id,
          guardian_id: null,
          reason: SkipReason.NO_GUARDIANS,
        });
        continue;
      }

      // Selection runs over the reachable guardians (so an opted-out sole
      // primary promotes the reachable non-primaries rather than silencing
      // the student), while the reported skips are limited to opt-outs that
      // would actually have been selected. See resolveReminderAudience. [5.4c]
      const { guardians, skippedOptOut } = resolveReminderAudience(linked);
      for (const guardian of skippedOptOut) {
        skipped.push({
          student_id: student.id,
          guardian_id: guardian.id,
          reason: SkipReason.NOTIFICATIONS_DISABLED,
        });
      }

      // A student whose guardians have ALL opted out gets the per-guardian
      // entries above only — no misleading NO_GUARDIANS on top.
      if (guardians.length === 0) {
        continue;
      }

      const dueMonth =
        snapshot.earliest_due_month !== null && snapshot.earliest_due_year !== null
          ? formatDueMonth(snapshot.earliest_due_month, snapshot.earliest_due_year)
          : '';

      for (const guardian of guardians) {
        const medium = guardian.preferred_communication;

        if (allowed && !allowed.has(medium)) {
          skipped.push({
            student_id: student.id,
            guardian_id: guardian.id,
            reason: SkipReason.MEDIUM_NOT_ALLOWED,
          });
          continue;
        }
        if (!DISPATCHABLE_MEDIA.includes(medium)) {
          skipped.push({
            student_id: student.id,
            guardian_id: guardian.id,
            reason: SkipReason.NO_AUTOMATED_PROVIDER,
          });
          continue;
        }

        const address = addressForMedium(guardian, medium);
        if (!address) {
          skipped.push({
            student_id: student.id,
            guardian_id: guardian.id,
            reason: SkipReason.MISSING_ADDRESS,
          });
          continue;
        }

        recipients.push({
          student,
          guardian,
          medium,
          address,
          vars: {
            student_name: student.full_name,
            guardian_name: guardian.full_name,
            due_amount: formatDueAmount(snapshot.total_due),
            due_month: dueMonth,
          },
        });
      }
    }

    return recipients;
  }

  private async queueRecipients(
    recipients: ResolvedRecipient[],
    batch: ReminderBatch,
    dto: SendBulkReminderDto,
    tenantId: string,
    userId: string,
  ): Promise<{ queued: number; failed: number }> {
    let queued = 0;
    let failed = 0;

    for (const recipient of recipients) {
      const log = await this.logRepo.save(
        this.logRepo.create({
          tenant_id: tenantId,
          reminder_batch_id: batch.id,
          medium: recipient.medium,
          recipient_address: recipient.address,
          recipient_name: recipient.guardian.full_name,
          message_body: renderReminderTemplate(dto.message_template, recipient.vars),
          subject: recipient.medium === CommunicationMedium.EMAIL ? this.emailSubject(dto) : null,
          student_id: recipient.student.id,
          guardian_id: recipient.guardian.id,
          sent_by_user_id: userId,
          status: CommunicationStatus.QUEUED,
          trigger: CommunicationTrigger.BULK_REMINDER,
          metadata: this.whatsAppMetadata(dto, recipient),
        }),
      );

      try {
        await this.queue.add('send', { logId: log.id });
        queued++;
      } catch {
        // One recipient failing to enqueue shouldn't abort the rest of the
        // batch, but the row must not be left QUEUED with no job behind it.
        // Save and counter update run in one transaction — same reasoning
        // as CommunicationsProcessor.settle: separately, a crash between
        // them would leave a FAILED log whose outcome was never counted.
        log.status = CommunicationStatus.FAILED;
        log.metadata = { ...log.metadata, error: 'Failed to enqueue for delivery' };
        await this.logRepo.manager.transaction(async (manager) => {
          await manager.save(log);
          await recordBatchOutcome(manager, batch.id, 'failure');
        });
        failed++;
      }
    }

    return { queued, failed };
  }

  /**
   * WhatsApp template params are named here and positional at Meta's end, so
   * a name the renderer can't fill would silently send an empty parameter
   * and get the message rejected. Catch it before the batch is created.
   */
  private validateWhatsAppParams(dto: SendBulkReminderDto): void {
    const unknown = (dto.whatsapp_template_params ?? []).filter(
      (name) => !isSupportedPlaceholder(name),
    );
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unsupported whatsapp_template_params: ${unknown.join(', ')}. ` +
          `Supported: ${SUPPORTED_PLACEHOLDERS.join(', ')}`,
      );
    }
  }

  /**
   * Shares resolveWhatsAppTemplate with previewBulk on purpose: the review
   * step must show the same template name, language and positional params
   * the worker will actually dispatch.
   */
  private whatsAppMetadata(
    dto: SendBulkReminderDto,
    recipient: ResolvedRecipient,
  ): Record<string, unknown> | null {
    return whatsAppTemplateMetadata(resolveWhatsAppTemplate(recipient.medium, recipient.vars, dto));
  }

  private emailSubject(dto: SendBulkReminderDto): string {
    return (dto.batch_name || 'Fee Reminder').slice(0, 200);
  }

  private defaultBatchName(): string {
    return `Fee Reminder ${new Date().toISOString().slice(0, 10)}`;
  }

  private toListItemDto(batch: ReminderBatch): ReminderBatchListItemDto {
    return {
      id: batch.id,
      batch_name: batch.batch_name,
      status: batch.status,
      total_recipients: batch.total_recipients,
      successful_count: batch.successful_count,
      failed_count: batch.failed_count,
      created_at: batch.created_at,
    };
  }

  private toBatchLogDto(log: CommunicationLog): ReminderBatchLogDto {
    return {
      id: log.id,
      medium: log.medium,
      recipient_address: log.recipient_address,
      recipient_name: log.recipient_name,
      status: log.status,
      student_id: log.student_id,
      guardian_id: log.guardian_id,
      provider_message_id: log.provider_message_id,
      error: typeof log.metadata?.error === 'string' ? log.metadata.error : null,
      created_at: log.created_at,
    };
  }

  private toResponseDto(
    batch: ReminderBatch,
    skipped: SkippedRecipientDto[],
  ): ReminderBatchResponseDto {
    return {
      id: batch.id,
      batch_name: batch.batch_name,
      status: batch.status,
      total_recipients: batch.total_recipients,
      successful_count: batch.successful_count,
      failed_count: batch.failed_count,
      message_template: batch.message_template,
      created_at: batch.created_at,
      // The batch's original targeting, so the detail page can retry the
      // failures on the same channels with the same approved template
      // rather than on looser defaults. Null means "each guardian's
      // preferred channel", which is what the send used.
      mediums: (batch.filters_applied?.mediums as CommunicationMedium[] | null) ?? null,
      whatsapp_template_name:
        (batch.filters_applied?.whatsapp_template_name as string | null) ?? null,
      whatsapp_template_language:
        (batch.filters_applied?.whatsapp_template_language as string | null) ?? null,
      whatsapp_template_params:
        (batch.filters_applied?.whatsapp_template_params as string[] | null) ?? null,
      skipped,
    };
  }
}
