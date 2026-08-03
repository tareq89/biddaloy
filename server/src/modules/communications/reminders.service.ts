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
} from './dto/reminders.dto';
import {
  findUnsupportedPlaceholders,
  renderReminderTemplate,
  formatDueAmount,
  formatDueMonth,
  ReminderTemplateVars,
  SUPPORTED_PLACEHOLDERS,
  isSupportedPlaceholder,
  templateVarValue,
} from './reminder-template.util';
import { recordBatchOutcome } from './reminder-batch-counters';
import { COMMUNICATIONS_QUEUE } from './communications.constants';
import { selectReminderGuardians, addressForMedium, DISPATCHABLE_MEDIA } from './reminder-recipients.util';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import {
  AuditAction,
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  ReminderBatchStatus,
} from '@beton-boi/shared';

// Re-exported so existing imports (this file's own spec, in particular)
// keep working — the shared #18 single-reminder flow needs these too, so
// they now live in reminder-recipients.util.ts.
export { selectReminderGuardians, addressForMedium };

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

    const batch = await this.batchRepo.save(
      this.batchRepo.create({
        tenant_id: tenantId,
        batch_name: dto.batch_name || this.defaultBatchName(),
        // Nothing to dispatch is a finished batch, not a stuck one.
        status: recipients.length === 0 ? ReminderBatchStatus.COMPLETED : ReminderBatchStatus.PROCESSING,
        total_recipients: recipients.length,
        message_template: dto.message_template,
        initiated_by_user_id: userId,
        filters_applied: {
          student_ids: studentIds,
          mediums: dto.mediums ?? null,
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
        skipped.push({ student_id: student.id, guardian_id: null, reason: SkipReason.NO_OPEN_DUES });
        continue;
      }

      const guardians = selectReminderGuardians(student.guardians ?? []);
      if (guardians.length === 0) {
        skipped.push({ student_id: student.id, guardian_id: null, reason: SkipReason.NO_GUARDIANS });
        continue;
      }

      const dueMonth =
        snapshot.earliest_due_month !== null && snapshot.earliest_due_year !== null
          ? formatDueMonth(snapshot.earliest_due_month, snapshot.earliest_due_year)
          : '';

      for (const guardian of guardians) {
        const medium = guardian.preferred_communication;

        if (allowed && !allowed.has(medium)) {
          skipped.push({ student_id: student.id, guardian_id: guardian.id, reason: SkipReason.MEDIUM_NOT_ALLOWED });
          continue;
        }
        if (!DISPATCHABLE_MEDIA.includes(medium)) {
          skipped.push({ student_id: student.id, guardian_id: guardian.id, reason: SkipReason.NO_AUTOMATED_PROVIDER });
          continue;
        }

        const address = addressForMedium(guardian, medium);
        if (!address) {
          skipped.push({ student_id: student.id, guardian_id: guardian.id, reason: SkipReason.MISSING_ADDRESS });
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
    const unknown = (dto.whatsapp_template_params ?? []).filter((name) => !isSupportedPlaceholder(name));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unsupported whatsapp_template_params: ${unknown.join(', ')}. ` +
          `Supported: ${SUPPORTED_PLACEHOLDERS.join(', ')}`,
      );
    }
  }

  private whatsAppMetadata(
    dto: SendBulkReminderDto,
    recipient: ResolvedRecipient,
  ): Record<string, any> | null {
    if (recipient.medium !== CommunicationMedium.WHATSAPP || !dto.whatsapp_template_name) {
      return null;
    }
    return {
      template_name: dto.whatsapp_template_name,
      template_language: dto.whatsapp_template_language,
      template_params: (dto.whatsapp_template_params ?? []).map(
        (name) => templateVarValue(recipient.vars, name) ?? '',
      ),
    };
  }

  private emailSubject(dto: SendBulkReminderDto): string {
    return (dto.batch_name || 'Fee Reminder').slice(0, 200);
  }

  private defaultBatchName(): string {
    return `Fee Reminder ${new Date().toISOString().slice(0, 10)}`;
  }

  private toResponseDto(batch: ReminderBatch, skipped: SkippedRecipientDto[]): ReminderBatchResponseDto {
    return {
      id: batch.id,
      batch_name: batch.batch_name,
      status: batch.status,
      total_recipients: batch.total_recipients,
      successful_count: batch.successful_count,
      failed_count: batch.failed_count,
      message_template: batch.message_template,
      created_at: batch.created_at,
      skipped,
    };
  }
}
