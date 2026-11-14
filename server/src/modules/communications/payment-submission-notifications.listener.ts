import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PaymentProofRejectReason } from '@biddaloy/shared';
import {
  PAYMENT_SUBMISSION_EVENTS,
  paymentSubmissionEvents,
  type PaymentSubmissionEventPayload,
} from '../payment-submissions/payment-submission.events';
import { PushService } from '../push/push.service';
import { SchoolsService } from '../schools/schools.service';
import {
  resolveTemplateLocale,
  type TemplateLocale,
} from '../account-access/account-access-templates';

type Kind = 'SUBMITTED' | 'CONFIRMED' | 'REJECTED' | 'DISCARDED';

const TITLES: Record<Kind, Record<TemplateLocale, string>> = {
  SUBMITTED: { bn: 'পেমেন্ট প্রমাণ পাওয়া গেছে', en: 'Payment proof received' },
  CONFIRMED: { bn: 'পেমেন্ট নিশ্চিত হয়েছে', en: 'Payment confirmed' },
  REJECTED: { bn: 'পেমেন্ট প্রমাণ বাতিল হয়েছে', en: 'Payment proof rejected' },
  DISCARDED: { bn: 'পেমেন্ট প্রমাণ বাদ দেওয়া হয়েছে', en: 'Payment proof discarded' },
};

/** Fixed labels only: the staff's free-text note is never pushed (Rule 23). */
const REASON_LABELS: Record<PaymentProofRejectReason, Record<TemplateLocale, string>> = {
  TRXID_NOT_FOUND: { bn: 'ট্রানজেকশন আইডি খুঁজে পাওয়া যায়নি', en: 'Transaction ID not found' },
  AMOUNT_MISMATCH: { bn: 'টাকার পরিমাণ মেলেনি', en: 'Amount does not match' },
  IMAGE_UNCLEAR: { bn: 'ছবি স্পষ্ট নয়', en: 'Image is unclear' },
  DUPLICATE: { bn: 'আগেই জমা দেওয়া হয়েছে', en: 'Already submitted' },
  OTHER: { bn: 'অন্য কারণ', en: 'Other reason' },
};

const BODIES: Record<Kind, Record<TemplateLocale, string>> = {
  SUBMITTED: {
    bn: 'স্কুল যাচাই করলে আপনাকে জানানো হবে।',
    en: 'The school will review it and let you know.',
  },
  CONFIRMED: {
    bn: 'আপনার পেমেন্ট গ্রহণ করা হয়েছে।',
    en: 'Your payment has been accepted.',
  },
  REJECTED: { bn: 'কারণ: ', en: 'Reason: ' },
  DISCARDED: {
    bn: 'স্কুল এই প্রমাণটি বাদ দিয়েছে।',
    en: 'The school discarded this proof.',
  },
};

/**
 * [3.x D31] Pushes one notification to the guardian who submitted a payment proof when it is
 * submitted, confirmed, rejected or discarded. Push only: no SMS (D10, D23). The recipient is
 * always `submitted_by_user_id`, loaded by `(id, tenant_id)` so another school's id finds nothing.
 */
@Injectable()
export class PaymentSubmissionNotificationsListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentSubmissionNotificationsListener.name);

  private readonly handlers: [string, Kind, (p: PaymentSubmissionEventPayload) => void][] = (
    ['SUBMITTED', 'CONFIRMED', 'REJECTED', 'DISCARDED'] as const
  ).map((kind) => [PAYMENT_SUBMISSION_EVENTS[kind], kind, (p) => void this.handle(kind, p)]);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly pushService: PushService,
    private readonly schoolsService: SchoolsService,
  ) {}

  onModuleInit(): void {
    for (const [name, , fn] of this.handlers) paymentSubmissionEvents.on(name, fn);
  }

  onModuleDestroy(): void {
    for (const [name, , fn] of this.handlers) paymentSubmissionEvents.off(name, fn);
  }

  /** Never throws: a failed push must not undo a committed review. */
  async handle(kind: Kind, event: PaymentSubmissionEventPayload): Promise<void> {
    try {
      const [row]: {
        submitted_by_user_id: string;
        source: string;
        reject_reason: PaymentProofRejectReason | null;
      }[] = await this.dataSource.query(
        `SELECT submitted_by_user_id, source, reject_reason
         FROM payment_submissions WHERE id = $1 AND tenant_id = $2`,
        [event.submissionId, event.tenantId],
      );
      if (!row || row.source !== 'PROOF') return;
      const settings = await this.schoolsService.getResolvedSettings(event.tenantId);
      const locale = resolveTemplateLocale(settings.region?.locale);
      const reason =
        kind === 'REJECTED' && row.reject_reason ? REASON_LABELS[row.reject_reason][locale] : '';
      await this.pushService.sendToUser(row.submitted_by_user_id, event.tenantId, {
        type: `PAYMENT_PROOF_${kind}`,
        title: TITLES[kind][locale],
        // No reason on the row: never leave a dangling "Reason:" prefix.
        body:
          kind === 'REJECTED' && !reason ? TITLES.REJECTED[locale] : BODIES[kind][locale] + reason,
        url: '/',
      });
    } catch (e) {
      this.logger.warn(`Payment proof ${kind} push failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
