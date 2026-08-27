import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { CommunicationLog } from './entities/communication-log.entity';
import { StudentService, GuardianService } from '../students/students.service';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { FeeDuesService } from '../fees/fee-dues.service';
import {
  SendSingleReminderDto,
  ReminderPreviewResponseDto,
  SingleReminderResponseDto,
  SkippedGuardianDto,
} from './dto/single-reminder.dto';
import {
  findUnsupportedPlaceholders,
  renderReminderTemplate,
  formatDueAmount,
  formatDueMonth,
  ReminderTemplateVars,
  SUPPORTED_PLACEHOLDERS,
  isSupportedPlaceholder,
} from './reminder-template.util';
import {
  partitionByOptOut,
  resolveReminderAudience,
  addressForMedium,
  DISPATCHABLE_MEDIA,
} from './reminder-recipients.util';
import { resolveWhatsAppTemplate, whatsAppTemplateMetadata } from './whatsapp-template.util';
import { SkipReason } from './reminders.service';
import { COMMUNICATIONS_QUEUE } from './communications.constants';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import {
  AuditAction,
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
} from '@biddaloy/shared';

const DEFAULT_EMAIL_SUBJECT = 'Fee Reminder';

interface ResolvedSingleRecipient {
  guardian: Guardian;
  medium: CommunicationMedium;
  address: string;
  vars: ReminderTemplateVars;
}

interface ResolvedContext {
  student: Student;
  recipients: ResolvedSingleRecipient[];
  skipped: SkippedGuardianDto[];
}

/**
 * Single-student counterpart to BulkReminderService (#17) — same recipient
 * and template-rendering rules, but scoped to one student with an explicit
 * preview step and per-send guardian/medium overrides (#18). No
 * ReminderBatch here: the issue doesn't ask for campaign tracking at this
 * scale, and a single send doesn't need a progress counter.
 */
@Injectable()
export class SingleReminderService {
  constructor(
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectQueue(COMMUNICATIONS_QUEUE)
    private readonly queue: Queue,
    private readonly studentService: StudentService,
    private readonly guardianService: GuardianService,
    private readonly feeDuesService: FeeDuesService,
    private readonly auditService: AuditService,
  ) {}

  async preview(
    studentId: string,
    dto: SendSingleReminderDto,
    tenantId: string,
  ): Promise<ReminderPreviewResponseDto> {
    const { recipients, skipped } = await this.resolve(studentId, dto, tenantId);

    return {
      student_id: studentId,
      recipients: recipients.map((r) => ({
        guardian_id: r.guardian.id,
        guardian_name: r.guardian.full_name,
        medium: r.medium,
        address: r.address,
        message_body: renderReminderTemplate(dto.message_template, r.vars),
        subject: r.medium === CommunicationMedium.EMAIL ? DEFAULT_EMAIL_SUBJECT : null,
        // A WhatsApp recipient receives this approved template, not the
        // rendered body above — see whatsapp-template.util.ts. Resolved
        // with the same helper sendSingle uses, so the review step and the
        // send cannot disagree.
        whatsapp_template: resolveWhatsAppTemplate(r.medium, r.vars, dto),
      })),
      skipped,
    };
  }

  async sendSingle(
    studentId: string,
    dto: SendSingleReminderDto,
    tenantId: string,
    userId: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<SingleReminderResponseDto> {
    const { recipients, skipped } = await this.resolve(studentId, dto, tenantId);

    const sent: SingleReminderResponseDto['sent'] = [];
    for (const recipient of recipients) {
      const log = await this.logRepo.save(
        this.logRepo.create({
          tenant_id: tenantId,
          medium: recipient.medium,
          recipient_address: recipient.address,
          recipient_name: recipient.guardian.full_name,
          message_body: renderReminderTemplate(dto.message_template, recipient.vars),
          subject: recipient.medium === CommunicationMedium.EMAIL ? DEFAULT_EMAIL_SUBJECT : null,
          student_id: studentId,
          guardian_id: recipient.guardian.id,
          sent_by_user_id: userId,
          status: CommunicationStatus.QUEUED,
          trigger: CommunicationTrigger.SINGLE_REMINDER,
          metadata: this.whatsAppMetadata(dto, recipient),
        }),
      );

      try {
        await this.queue.add('send', { logId: log.id });
      } catch {
        // One guardian failing to enqueue shouldn't abort the others in the
        // same request; the row must not be left QUEUED with no job behind it.
        log.status = CommunicationStatus.FAILED;
        log.metadata = { ...log.metadata, error: 'Failed to enqueue for delivery' };
        await this.logRepo.save(log);
      }

      sent.push({
        communication_log_id: log.id,
        guardian_id: recipient.guardian.id,
        guardian_name: recipient.guardian.full_name,
        medium: recipient.medium,
        status: log.status,
      });
    }

    // One record per send action, not per guardian recipient — same
    // one-row-per-action precedent as the bulk flow's batch-level record.
    await this.auditService.record({
      action: AuditAction.REMINDER_SENT,
      entity_type: 'Student',
      entity_id: studentId,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: {
        recipient_count: sent.length,
        queued_count: sent.filter((s) => s.status === CommunicationStatus.QUEUED).length,
        failed_count: sent.filter((s) => s.status === CommunicationStatus.FAILED).length,
        skipped_count: skipped.length,
      },
    });

    return { student_id: studentId, sent, skipped };
  }

  /**
   * Shared by preview and send: validates the request, resolves which
   * guardians get contacted and on what channel, and renders the template
   * vars each will need. Throws rather than returning an empty result for
   * anything that makes a single-student action meaningless — the guardian
   * clicking "remind this student" deserves a clear error, not a silent
   * success that sent nothing (unlike the bulk flow, where skipping a few
   * of many students is normal and expected).
   */
  private async resolve(
    studentId: string,
    dto: SendSingleReminderDto,
    tenantId: string,
  ): Promise<ResolvedContext> {
    const unsupported = findUnsupportedPlaceholders(dto.message_template);
    if (unsupported.length > 0) {
      throw new BadRequestException(
        `Unsupported template placeholder(s): ${unsupported.join(', ')}. ` +
          `Supported: ${SUPPORTED_PLACEHOLDERS.join(', ')}`,
      );
    }
    this.validateWhatsAppParams(dto);

    const student = await this.studentService.findOne(studentId, tenantId);

    const linked = student.guardians ?? [];

    // Candidates: either the explicit staff selection (tenant- and
    // linkage-validated) or the default primary-contact selection. The
    // opt-out is applied to BOTH — resolveExplicitGuardians bypasses
    // selectReminderGuardians, so gating only the latter would still
    // message opted-out guardians staff picked by hand. Explicit selection
    // deliberately does NOT override the opt-out; the ungated channel for
    // obligatory messages is the staff freeform send. [5.4c]
    const candidates = dto.guardian_ids?.length
      ? await this.resolveExplicitGuardians(student, dto.guardian_ids, tenantId)
      : linked;

    if (candidates.length === 0) {
      throw new BadRequestException(`Student "${studentId}" has no guardians on file`);
    }

    // Explicit path: staff named these guardians, so every opt-out among
    // them is worth reporting back. Default path: selection still runs over
    // the reachable guardians (an opted-out sole primary promotes the
    // reachable non-primaries), but only opt-outs that would actually have
    // been selected are reported — see resolveReminderAudience. [5.4c]
    let guardians: Guardian[];
    let optedOut: Guardian[];
    if (dto.guardian_ids?.length) {
      ({ reachable: guardians, optedOut } = partitionByOptOut(candidates));
    } else {
      ({ guardians, skippedOptOut: optedOut } = resolveReminderAudience(candidates));
    }

    const snapshot = (await this.feeDuesService.getDueSnapshots([studentId], tenantId)).get(
      studentId,
    );
    if (!snapshot) {
      throw new BadRequestException(`Student "${studentId}" has no open dues to remind about`);
    }

    const dueMonth =
      snapshot.earliest_due_month !== null && snapshot.earliest_due_year !== null
        ? formatDueMonth(snapshot.earliest_due_month, snapshot.earliest_due_year)
        : '';

    const recipients: ResolvedSingleRecipient[] = [];
    const skipped: SkippedGuardianDto[] = optedOut.map((guardian) => ({
      guardian_id: guardian.id,
      guardian_name: guardian.full_name,
      reason: SkipReason.NOTIFICATIONS_DISABLED,
    }));

    for (const guardian of guardians) {
      // `dto.medium` overrides every selected guardian's channel for this
      // send only — never written back to guardian.preferred_communication.
      const medium = dto.medium ?? guardian.preferred_communication;

      if (!DISPATCHABLE_MEDIA.includes(medium)) {
        skipped.push({
          guardian_id: guardian.id,
          guardian_name: guardian.full_name,
          reason: SkipReason.NO_AUTOMATED_PROVIDER,
        });
        continue;
      }

      const address = addressForMedium(guardian, medium);
      if (!address) {
        skipped.push({
          guardian_id: guardian.id,
          guardian_name: guardian.full_name,
          reason: SkipReason.MISSING_ADDRESS,
        });
        continue;
      }

      recipients.push({
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

    if (recipients.length === 0) {
      const reasons = skipped.map((s) => `${s.guardian_name} (${s.reason})`).join(', ');
      throw new BadRequestException(
        `No deliverable guardian for student "${studentId}" — every candidate was skipped: ${reasons}`,
      );
    }

    return { student, recipients, skipped };
  }

  /**
   * Validates caller-supplied guardian_ids belong to both the tenant (via
   * GuardianService.findOne, which 404s on mismatch) and this specific
   * student — otherwise a caller could message an unrelated guardian in the
   * same school by supplying an arbitrary ID from elsewhere in the tenant.
   */
  private async resolveExplicitGuardians(
    student: Student,
    guardianIds: string[],
    tenantId: string,
  ): Promise<Guardian[]> {
    const studentGuardianIds = new Set((student.guardians ?? []).map((g) => g.id));
    const uniqueIds = [...new Set(guardianIds)];

    const guardians = await Promise.all(
      uniqueIds.map((id) => this.guardianService.findOne(id, tenantId)),
    );

    const notLinked = guardians.filter((g) => !studentGuardianIds.has(g.id));
    if (notLinked.length > 0) {
      throw new BadRequestException(
        `Guardian(s) not linked to student "${student.id}": ${notLinked.map((g) => g.id).join(', ')}`,
      );
    }

    return guardians;
  }

  private validateWhatsAppParams(dto: SendSingleReminderDto): void {
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

  /** Shares resolveWhatsAppTemplate with preview — see that method. */
  private whatsAppMetadata(
    dto: SendSingleReminderDto,
    recipient: ResolvedSingleRecipient,
  ): Record<string, unknown> | null {
    return whatsAppTemplateMetadata(resolveWhatsAppTemplate(recipient.medium, recipient.vars, dto));
  }
}
