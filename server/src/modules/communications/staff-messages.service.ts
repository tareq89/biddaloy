import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import {
  AuditAction,
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  Permission,
  ReminderBatchStatus,
  countSmsSegments,
  roleHasPermission,
} from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../../common/request-context.util';
import { localToday } from '../../common/time';
import { COMMUNICATIONS_QUEUE } from './communications.constants';
import { INSUFFICIENT_SMS_CREDIT } from './credits/insufficient-sms-credit.constants';
import { SmsCreditService } from './credits/sms-credit.service';
import {
  StaffMessageDto,
  StaffMessagePreviewResponseDto,
  StaffMessageSendResponseDto,
} from './dto/staff-message.dto';
import { CommunicationLog } from './entities/communication-log.entity';
import { ReminderBatch } from './entities/reminder-batch.entity';
import { recordBatchOutcome } from './reminder-batch-counters';
import { StaffAudienceResult, StaffAudienceService } from './staff-audience.service';
import { whatsAppTemplateMetadata } from './whatsapp-template.util';

/** One fixed sentence per failure; none carries a name, id, phone or the typed text (Rules 13, 23). */
export const STAFF_MESSAGE_FORBIDDEN = 'You cannot message staff.';
export const STAFF_MESSAGE_NO_AUDIENCE = 'No staff to message in your classes.';
export const STAFF_MESSAGE_NO_RECIPIENTS = 'No one in this audience has a phone number.';
export const STAFF_MESSAGE_DUPLICATE =
  'This message was just sent to the same people. Wait a minute.';
export const STAFF_MESSAGE_INSUFFICIENT_CREDIT = 'Insufficient SMS credit to send this batch.';
/** D32: the same sender, text and audience inside this window is a double click, not a new send. */
export const STAFF_MESSAGE_DUPLICATE_WINDOW_MS = 60_000;

type CallerScope = 'school' | 'coordinated';

/**
 * [80.1.05] Preview and send an SMS / WhatsApp message to a staff audience. Clone of
 * `BulkReminderService.sendBulk`: batch, credit reserve under `batch:<id>`, one log per person,
 * compensating delete of the batch when the reserve is refused or throws (D8, D34, D35).
 */
@Injectable()
export class StaffMessagesService {
  private readonly logger = new Logger(StaffMessagesService.name);

  constructor(
    @InjectRepository(CommunicationLog) private readonly logRepo: Repository<CommunicationLog>,
    @InjectRepository(ReminderBatch) private readonly batchRepo: Repository<ReminderBatch>,
    @InjectQueue(COMMUNICATIONS_QUEUE) private readonly queue: Queue,
    private readonly audience: StaffAudienceService,
    private readonly smsCreditService: SmsCreditService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * The guard is all-of, so the any-of rule lives here (D2, D28): STAFF_MESSAGE_SEND is
   * school-wide, STAFF_MESSAGE_COORDINATED only the caller's coordinated classes.
   */
  callerScope(role: string): CallerScope {
    if (roleHasPermission(role, Permission.STAFF_MESSAGE_SEND)) return 'school';
    if (roleHasPermission(role, Permission.STAFF_MESSAGE_COORDINATED)) return 'coordinated';
    throw new ForbiddenException(STAFF_MESSAGE_FORBIDDEN);
  }

  async preview(
    dto: StaffMessageDto,
    tenantId: string,
    userId: string,
    role: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<StaffMessagePreviewResponseDto> {
    const resolved = await this.resolve(dto, tenantId, userId, role);
    const each = this.segmentsEach(dto);
    const credits_needed = each * resolved.recipients.length;

    let balance: number | null = null;
    if (credits_needed > 0 && (await this.smsCreditService.isMetered(tenantId))) {
      balance = (await this.smsCreditService.getBalance(tenantId)).available;
    }

    await this.auditService.record({
      action: AuditAction.REMINDER_PREVIEWED,
      entity_type: 'ReminderBatch',
      entity_id: null,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: {
        kind: 'STAFF_MESSAGE',
        recipient_count: resolved.recipients.length,
        skipped_count: resolved.skipped.length,
        medium: dto.medium,
      },
    });

    return {
      people: resolved.recipients.length + resolved.skipped.length,
      with_phone: resolved.recipients.length,
      skipped: resolved.skipped,
      segments_each: each,
      credits_needed,
      balance,
      shortfall: balance === null ? 0 : Math.max(0, credits_needed - balance),
      whatsapp_template: this.template(dto),
    };
  }

  async send(
    dto: StaffMessageDto,
    tenantId: string,
    userId: string,
    role: string,
    context: RequestContext = { ip: null, userAgent: null },
  ): Promise<StaffMessageSendResponseDto> {
    const { recipients, skipped } = await this.resolve(dto, tenantId, userId, role);
    if (!recipients.length) throw new BadRequestException(STAFF_MESSAGE_NO_RECIPIENTS);

    const audienceHash = this.hash(dto);
    const eachSegments = this.segmentsEach(dto);
    const totalSegments = eachSegments * recipients.length;
    const template = this.template(dto);

    // The 60-second window can't be a unique index, so the count and the insert share one
    // transaction behind a per-sender advisory lock; two overlapping sends can't both pass.
    const batch = await this.batchRepo.manager.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `staff-message:${tenantId}:${userId}`,
      ]);
      await this.assertNotDuplicate(
        manager.getRepository(ReminderBatch),
        tenantId,
        userId,
        audienceHash,
      );
      return manager.getRepository(ReminderBatch).save(
        this.batchRepo.create({
          tenant_id: tenantId,
          batch_name: `Staff message ${localToday()}`,
          status: ReminderBatchStatus.PROCESSING,
          total_recipients: recipients.length,
          message_template: dto.message,
          initiated_by_user_id: userId,
          filters_applied: {
            kind: 'STAFF_MESSAGE',
            audience: dto.audience,
            medium: dto.medium,
            mediums: [dto.medium],
            message_hash: audienceHash,
            whatsapp_template_name: template?.name ?? null,
            whatsapp_template_language: template?.language ?? null,
            whatsapp_template_params: template?.params ?? null,
            skipped,
          },
        }),
      );
    });

    // Reserve BEFORE any log or job exists. A refusal or a throw deletes the batch, so nothing
    // is left behind (D8, D34, D35).
    let metered = false;
    if (totalSegments > 0 && (await this.smsCreditService.isMetered(tenantId))) {
      metered = true;
      let reservation: { ok: true } | { ok: false; available: number };
      try {
        reservation = await this.smsCreditService.reserve(
          tenantId,
          totalSegments,
          `batch:${batch.id}`,
          { type: 'batch', id: batch.id },
        );
      } catch (err) {
        await this.batchRepo.delete({ id: batch.id, tenant_id: tenantId });
        throw err;
      }
      if (!reservation.ok) {
        await this.batchRepo.delete({ id: batch.id, tenant_id: tenantId });
        throw new ConflictException({
          message: STAFF_MESSAGE_INSUFFICIENT_CREDIT,
          details: {
            code: INSUFFICIENT_SMS_CREDIT,
            required: totalSegments,
            available: reservation.available,
          },
        });
      }
    }

    let queued = 0;
    let failed = 0;
    for (const person of recipients) {
      let log: CommunicationLog;
      try {
        log = await this.logRepo.save(
          this.logRepo.create({
            tenant_id: tenantId,
            reminder_batch_id: batch.id,
            medium: dto.medium,
            recipient_address: person.phone,
            recipient_name: person.name,
            recipient_user_id: person.user_id,
            message_body: dto.message,
            subject: null,
            student_id: null,
            guardian_id: null,
            sent_by_user_id: userId,
            status: CommunicationStatus.QUEUED,
            trigger: CommunicationTrigger.STAFF_MESSAGE,
            metadata: whatsAppTemplateMetadata(template),
          }),
        );
      } catch (err) {
        // The log row never existed: count the person as failed and give their units back.
        await recordBatchOutcome(this.logRepo.manager, batch.id, 'failure');
        failed++;
        if (metered && dto.medium === CommunicationMedium.SMS) {
          await this.smsCreditService
            .settlePart(
              tenantId,
              `batch:${batch.id}`,
              `person:${person.user_id}`,
              eachSegments,
              'RELEASE',
            )
            .catch(() => undefined);
        }
        this.logger.error({
          msg: 'staff message log save failed',
          batch_id: batch.id,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      // Only a metered school has a reservation for the worker to settle against.
      const segments = metered && dto.medium === CommunicationMedium.SMS ? eachSegments : undefined;
      try {
        await this.queue.add('send', {
          logId: log.id,
          batchId: batch.id,
          ...(segments !== undefined ? { segments } : {}),
        });
        queued++;
      } catch {
        log.status = CommunicationStatus.FAILED;
        log.metadata = { ...log.metadata, error: 'Failed to enqueue for delivery' };
        await this.logRepo.manager.transaction(async (manager) => {
          await manager.save(log);
          await recordBatchOutcome(manager, batch.id, 'failure');
        });
        failed++;
        if (metered && segments !== undefined) {
          try {
            await this.smsCreditService.settlePart(
              tenantId,
              `batch:${batch.id}`,
              `log:${log.id}`,
              segments,
              'RELEASE',
            );
          } catch (err) {
            this.logger.error({
              msg: 'sms credit release on enqueue failure failed — reservation left stranded',
              communication_log_id: log.id,
              batch_id: batch.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    }

    await this.auditService.record({
      action: AuditAction.REMINDER_SENT,
      entity_type: 'ReminderBatch',
      entity_id: batch.id,
      tenant_id: tenantId,
      performed_by_user_id: userId,
      ip_address: context.ip,
      user_agent: context.userAgent,
      new_values: {
        kind: 'STAFF_MESSAGE',
        recipient_count: recipients.length,
        queued_count: queued,
        failed_count: failed,
        skipped_count: skipped.length,
        medium: dto.medium,
      },
    });

    return { batch_id: batch.id, total_recipients: recipients.length, queued, failed, skipped };
  }

  private async resolve(
    dto: StaffMessageDto,
    tenantId: string,
    userId: string,
    role: string,
  ): Promise<StaffAudienceResult> {
    const coordinated = this.callerScope(role) === 'coordinated';
    const result = await this.audience.resolve(
      tenantId,
      dto.audience,
      coordinated ? { coordinatedOnly: true, callerUserId: userId } : {},
    );
    if (coordinated && !result.recipients.length && !result.skipped.length) {
      throw new BadRequestException(STAFF_MESSAGE_NO_AUDIENCE);
    }
    return result;
  }

  /** Text goes as typed (D9, D24); WhatsApp does not touch the SMS ledger. */
  private segmentsEach(dto: StaffMessageDto): number {
    return dto.medium === CommunicationMedium.SMS ? countSmsSegments(dto.message).segments : 0;
  }

  private template(dto: StaffMessageDto) {
    if (dto.medium !== CommunicationMedium.WHATSAPP) return null;
    return {
      name: dto.whatsapp_template_name as string,
      language: dto.whatsapp_template_language as string,
      params: dto.whatsapp_template_params ?? [],
    };
  }

  private hash(dto: StaffMessageDto): string {
    const a = dto.audience;
    const sorted = (xs?: string[]) => [...(xs ?? [])].sort();
    return createHash('sha256')
      .update(
        JSON.stringify([
          dto.message,
          dto.medium,
          sorted(a.roles),
          sorted(a.designationIds),
          a.teaching ?? null,
          sorted(a.userIds),
        ]),
      )
      .digest('hex');
  }

  /** D32. Same sender + same text/audience hash inside 60 s. Never echoes the input. */
  private async assertNotDuplicate(
    repo: Repository<ReminderBatch>,
    tenantId: string,
    userId: string,
    hash: string,
  ): Promise<void> {
    const since = new Date(Date.now() - STAFF_MESSAGE_DUPLICATE_WINDOW_MS);
    const found = await repo
      .createQueryBuilder('b')
      .where('b.tenant_id = :tenantId', { tenantId })
      .andWhere('b.initiated_by_user_id = :userId', { userId })
      .andWhere('b.created_at > :since', { since })
      .andWhere("b.filters_applied ->> 'message_hash' = :hash", { hash })
      .getCount();
    if (found > 0) throw new ConflictException(STAFF_MESSAGE_DUPLICATE);
  }
}
