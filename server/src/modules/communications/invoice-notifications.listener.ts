import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource, In, Repository } from 'typeorm';
import {
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  countSmsSegments,
} from '@biddaloy/shared';
import { CommunicationLog } from './entities/communication-log.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { Student } from '../students/entities/student.entity';
import { Payment } from '../fees/entities/payment.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { SchoolsService } from '../schools/schools.service';
import { SmsCreditService } from './credits/sms-credit.service';
import { InvoiceShareService } from '../invoices/invoice-share.service';
import { ConfigService } from '@nestjs/config';
import { resolvePublicAppUrl } from '../invoices/public-app-url.util';
import { COMMUNICATIONS_QUEUE } from './communications.constants';
import { addressForMedium, resolveReminderAudience } from './reminder-recipients.util';
import { buildInvoiceReceiptMessage } from './invoice-template.util';
import { resolveFeeNotificationLocale } from './fee-notification-template.util';
import {
  resolveFeeNotificationChannel,
  ResolvedFeeNotificationChannel,
} from './fee-notifications.listener';
import { checkoutEvents, PaymentsRecordedEvent } from '../fees/checkout.service';

const PAYMENT_NOTIFICATION_EVENT = 'payment-notify';

/** Same `metadata.reason` shape as `fee-notifications.listener.ts` — a log
 * created without a queued job because no channel was deliverable. */
const SKIPPED_NO_CHANNEL = 'SKIPPED_NO_SMS';

/** A log whose row saved but whose `queue.add` failed — replayable, see
 * `fee-notifications.listener.ts`'s identical constant. */
const ENQUEUE_FAILED = 'ENQUEUE_FAILED';

/**
 * [16.5.4] "Payment received" notification — fires after
 * `checkout.service.ts`'s `payments.recorded` event, sends the guardian(s)
 * the same receipt message the manual `POST /invoices/:id/send` route
 * builds (`buildInvoiceReceiptMessage`), push -> WhatsApp -> SMS (D13).
 *
 * Subscribed via `checkoutEvents` (a plain Node `EventEmitter` singleton —
 * see that file's doc comment for why), same pattern as
 * `FeeNotificationsListener`'s `feesEvents`.
 *
 * Deviation from the published plan: the ticket's step 2 gates this behind
 * `settings.fees.notify_on_payment` (default `true`). Adding that key
 * requires editing `shared/src/types/tenant-settings.types.ts`'s
 * `FeesSettings` interface (`DEFAULT_FEES_SETTINGS` and
 * `resolveTenantSettingsRow` are both typed directly against it) — outside
 * this ticket's "don't touch shared/" instruction, which says to stop and
 * report rather than edit it. This listener therefore always notifies
 * (the setting's own stated default), with the gate left as follow-up work
 * once the shared/ type change is approved.
 *
 * Idempotent per `(paymentId, guardianId)` via `reference_key`, same
 * replay-safe shape as the fee-notifications listener.
 */
@Injectable()
export class InvoiceNotificationsListener implements OnModuleInit {
  private readonly logger = new Logger(InvoiceNotificationsListener.name);

  constructor(
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectQueue(COMMUNICATIONS_QUEUE)
    private readonly queue: Queue,
    private readonly schoolsService: SchoolsService,
    private readonly smsCreditService: SmsCreditService,
    private readonly shareService: InvoiceShareService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    checkoutEvents.on('payments.recorded', (event: PaymentsRecordedEvent) => {
      void this.handlePaymentRecorded(event).catch((error) => {
        this.logger.error(
          `payments.recorded handler failed for payment ${event.payment_id}`,
          error instanceof Error ? error.stack : String(error),
        );
      });
    });
  }

  async handlePaymentRecorded(event: PaymentsRecordedEvent): Promise<void> {
    const { payment_id: paymentId, tenant_id: tenantId, student_ids: studentIds } = event;

    const payment = await this.dataSource.getRepository(Payment).findOne({
      where: { id: paymentId, tenant_id: tenantId },
    });
    if (!payment || !payment.invoice_id) {
      return;
    }

    const invoice = await this.dataSource.getRepository(Invoice).findOne({
      where: { id: payment.invoice_id },
    });
    if (!invoice) {
      return;
    }

    // The invoice was minted by `ensureInvoiceLinked` from the just-committed
    // payment's own allocations, so whoever recorded the payment (or, failing
    // that, whoever issued the invoice) stands in as the acting user for the
    // share token's audit trail — there is no HTTP caller here to attribute
    // it to. If genuinely neither is set (a payment recorded before either
    // column existed), skip rather than invent an actor id.
    const actorUserId = payment.received_by_user_id ?? invoice.issued_by_user_id;
    if (!actorUserId) {
      this.logger.warn(
        `Skipping payment-received notification for payment ${paymentId}: no actor user to mint a share token for.`,
      );
      return;
    }

    if (studentIds.length === 0) {
      return;
    }

    const students = await this.dataSource.getRepository(Student).find({
      where: { id: In(studentIds), tenant_id: tenantId },
      relations: ['guardians'],
    });

    const guardiansById = new Map<string, Guardian>();
    for (const student of students) {
      const linked = student.guardians ?? [];
      if (linked.length === 0) continue;
      const { guardians } = resolveReminderAudience(linked);
      for (const guardian of guardians) {
        guardiansById.set(guardian.id, guardian);
      }
    }
    if (guardiansById.size === 0) {
      return;
    }

    const settings = await this.schoolsService.getResolvedSettings(tenantId);
    const locale = resolveFeeNotificationLocale(settings.region?.locale);
    const smsAvailable = !!settings.communications?.sms?.provider;
    const whatsappAvailable = !!settings.communications?.whatsapp?.phoneNumberId;
    const metered = await this.smsCreditService.isMetered(tenantId);

    interface PlannedSend {
      guardianId: string;
      recipientAddress: string;
      recipientName: string;
      channel: ResolvedFeeNotificationChannel;
      referenceKey: string;
    }
    const planned: PlannedSend[] = [];
    const skipped: Array<{
      guardianId: string;
      recipientAddress: string;
      recipientName: string;
      referenceKey: string;
    }> = [];

    for (const [guardianId, guardian] of guardiansById) {
      const referenceKey = `${PAYMENT_NOTIFICATION_EVENT}:${paymentId}:${guardianId}`;
      const channel = resolveFeeNotificationChannel(guardian, smsAvailable, whatsappAvailable);
      if (!channel) {
        skipped.push({
          guardianId,
          recipientAddress: addressForMedium(guardian, CommunicationMedium.SMS) ?? 'unknown',
          recipientName: guardian.full_name,
          referenceKey,
        });
        continue;
      }
      planned.push({
        guardianId,
        recipientAddress: channel.address,
        recipientName: guardian.full_name,
        channel,
        referenceKey,
      });
    }

    const allKeys = [...planned.map((p) => p.referenceKey), ...skipped.map((s) => s.referenceKey)];
    if (allKeys.length === 0) {
      return;
    }
    const existing = await this.logRepo.find({
      where: allKeys.map((reference_key) => ({ tenant_id: tenantId, reference_key })),
      select: ['id', 'reference_key', 'status', 'metadata'],
    });
    const alreadyLogged = new Set<string>();
    const replayable = new Map<string, string>();
    for (const row of existing) {
      if (row.reference_key === null) continue;
      const enqueueFailed =
        row.status === CommunicationStatus.FAILED &&
        (row.metadata as { reason?: string } | null)?.reason === ENQUEUE_FAILED;
      if (enqueueFailed) {
        replayable.set(row.reference_key, row.id);
      } else {
        alreadyLogged.add(row.reference_key);
      }
    }

    const toSend = planned.filter((p) => !alreadyLogged.has(p.referenceKey));
    const toSkip = skipped.filter((s) => !alreadyLogged.has(s.referenceKey));

    if (toSend.length === 0 && toSkip.length === 0) {
      return;
    }

    const baseUrl = resolvePublicAppUrl(this.config);

    for (const item of toSend) {
      const { rawToken } = await this.shareService.createToken(invoice.id, tenantId, actorUserId);
      const shareUrl = `${baseUrl}/i/${rawToken}`;
      const message = buildInvoiceReceiptMessage(
        locale,
        invoice.invoice_number,
        Number(invoice.snapshot.totals.paid),
        shareUrl,
      );
      const segments =
        item.channel.medium === CommunicationMedium.SMS
          ? countSmsSegments(message).segments
          : undefined;

      let smsReserved = true;
      let reservationKey: string | undefined;
      if (item.channel.medium === CommunicationMedium.SMS && metered && segments) {
        reservationKey = item.referenceKey;
        const reservation = await this.smsCreditService.reserve(
          tenantId,
          segments,
          reservationKey,
          {
            type: 'log',
            id: null,
          },
        );
        smsReserved = reservation.ok;
      }

      if (!smsReserved) {
        await this.writeLog(tenantId, replayable, item.referenceKey, {
          medium: CommunicationMedium.SMS,
          recipient_address: item.recipientAddress,
          recipient_name: item.recipientName,
          message_body: '',
          student_id: null,
          guardian_id: item.guardianId,
          sent_by_user_id: null,
          status: CommunicationStatus.FAILED,
          trigger: CommunicationTrigger.AUTOMATED,
          metadata: { payment_id: paymentId, reason: SKIPPED_NO_CHANNEL },
        });
        continue;
      }

      const log = await this.writeLog(tenantId, replayable, item.referenceKey, {
        medium: item.channel.medium,
        recipient_address: item.recipientAddress,
        recipient_name: item.recipientName,
        message_body: message,
        student_id: null,
        guardian_id: item.guardianId,
        sent_by_user_id: null,
        status: CommunicationStatus.QUEUED,
        trigger: CommunicationTrigger.AUTOMATED,
        metadata: { payment_id: paymentId, invoice_id: invoice.id },
      });
      if (log === null) continue;

      try {
        await this.queue.add('send', {
          logId: log.id,
          ...(reservationKey && segments ? { batchId: reservationKey, segments } : {}),
        });
      } catch (error) {
        this.logger.warn(
          `Failed to enqueue payment-notification log ${log.id} for payment ${paymentId}: ${String(error)}`,
        );
        log.status = CommunicationStatus.FAILED;
        log.metadata = {
          ...log.metadata,
          reason: ENQUEUE_FAILED,
          error: 'Failed to enqueue for delivery',
        };
        await this.logRepo.save(log);
      }
    }

    for (const item of toSkip) {
      await this.writeLog(tenantId, replayable, item.referenceKey, {
        medium: CommunicationMedium.SMS,
        recipient_address: item.recipientAddress,
        recipient_name: item.recipientName,
        message_body: '',
        student_id: null,
        guardian_id: item.guardianId,
        sent_by_user_id: null,
        status: CommunicationStatus.FAILED,
        trigger: CommunicationTrigger.AUTOMATED,
        metadata: { payment_id: paymentId, reason: SKIPPED_NO_CHANNEL },
      });
    }
  }

  /** Same claim-in-place semantics as `fee-notifications.listener.ts`'s
   * `writeLog` — see that file's doc comment. */
  private async writeLog(
    tenantId: string,
    replayable: Map<string, string>,
    referenceKey: string,
    values: Omit<Partial<CommunicationLog>, 'id' | 'tenant_id' | 'reference_key'>,
  ): Promise<CommunicationLog | null> {
    const failedId = replayable.get(referenceKey);
    if (failedId === undefined) {
      return this.logRepo.save(
        this.logRepo.create({ ...values, tenant_id: tenantId, reference_key: referenceKey }),
      );
    }
    const claim = await this.logRepo
      .createQueryBuilder()
      .update(CommunicationLog)
      .set(values)
      .where('id = :id', { id: failedId })
      .andWhere('tenant_id = :tenantId', { tenantId })
      .andWhere('status = :status', { status: CommunicationStatus.FAILED })
      .andWhere(`metadata->>'reason' = :reason`, { reason: ENQUEUE_FAILED })
      .execute();
    if (!claim.affected) {
      return null;
    }
    return this.logRepo.findOneByOrFail({ id: failedId, tenant_id: tenantId });
  }
}
