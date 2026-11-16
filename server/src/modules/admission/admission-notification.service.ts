import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import {
  AdmissionApplicantStatus,
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
} from '@biddaloy/shared';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import {
  CREDIT_RESERVE_FAILED,
  INSUFFICIENT_SMS_CREDIT,
} from '../communications/credits/insufficient-sms-credit.constants';
import { School } from '../schools/entities/school.entity';
import { resolveTemplateLocale, TemplateLocale } from '../account-access/account-access-templates';
import { AdmissionApplicant } from './entities/admission-applicant.entity';

type NotifyApplicant = Pick<
  AdmissionApplicant,
  'id' | 'tenant_id' | 'applicant_name' | 'guardian_name' | 'guardian_phone' | 'status'
>;

type AdmissionTemplate = (applicantName: string, intakeTitle: string) => string;

// [#2265] Typed values (name, intake title) are inserted as typed (D15).
const TEMPLATE_BY_STATUS: Record<
  TemplateLocale,
  Partial<Record<AdmissionApplicantStatus, AdmissionTemplate>>
> = {
  en: {
    [AdmissionApplicantStatus.SHORTLISTED]: (name, intake) =>
      `Good news! ${name}'s application for ${intake} has been shortlisted. We will contact you with next steps.`,
    [AdmissionApplicantStatus.ADMITTED]: (name, intake) =>
      `Congratulations! ${name} has been admitted for ${intake}. Please contact the school office to complete enrollment.`,
    [AdmissionApplicantStatus.REJECTED]: (name, intake) =>
      `Thank you for applying. ${name}'s application for ${intake} was not successful this time.`,
  },
  bn: {
    [AdmissionApplicantStatus.SHORTLISTED]: (name, intake) =>
      `সুখবর! ${intake}-এ ${name}-এর আবেদন প্রাথমিকভাবে নির্বাচিত হয়েছে। পরবর্তী ধাপ আমরা জানাব।`,
    [AdmissionApplicantStatus.ADMITTED]: (name, intake) =>
      `অভিনন্দন! ${name} ${intake}-এ ভর্তির জন্য নির্বাচিত হয়েছে। ভর্তি সম্পন্ন করতে স্কুল অফিসে যোগাযোগ করুন।`,
    [AdmissionApplicantStatus.REJECTED]: (name, intake) =>
      `আবেদন করার জন্য ধন্যবাদ। এবার ${intake}-এ ${name}-এর আবেদন সফল হয়নি।`,
  },
};

// [#4178] Staff-typed reason is inserted as typed, like the names above.
const FEE_SENT_BACK: Record<
  TemplateLocale,
  (name: string, intake: string, reason: string) => string
> = {
  en: (name, intake, reason) =>
    `We could not verify the fee payment for ${name}'s application to ${intake}: ${reason}. Please contact the school office.`,
  bn: (name, intake, reason) =>
    `${intake}-এ ${name}-এর আবেদনের ফি পেমেন্ট যাচাই করা যায়নি: ${reason}। অনুগ্রহ করে স্কুল অফিসে যোগাযোগ করুন।`,
};

const dateText = (locale: TemplateLocale, at: Date) =>
  at.toLocaleString(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    timeZone: 'Asia/Dhaka',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
const dayText = (locale: TemplateLocale, at: Date) =>
  at.toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    timeZone: 'Asia/Dhaka',
    dateStyle: 'medium',
  });

// [#4184, D26] Same rule as above: typed values are inserted as typed.
const LIST_OFFER: Record<
  TemplateLocale,
  (name: string, intake: string, deadline?: Date | null) => string
> = {
  en: (name, intake, deadline) =>
    `Good news! ${name} has been offered a seat for ${intake}.` +
    (deadline ? ` Please confirm by ${dayText('en', deadline)}.` : '') +
    ' Contact the school office.',
  bn: (name, intake, deadline) =>
    `সুখবর! ${intake}-এ ${name}-কে আসন দেওয়া হয়েছে।` +
    (deadline ? ` অনুগ্রহ করে ${dayText('bn', deadline)} এর মধ্যে নিশ্চিত করুন।` : '') +
    ' স্কুল অফিসে যোগাযোগ করুন।',
};

const STAGE_SCHEDULE: Record<
  TemplateLocale,
  (name: string, intake: string, stage: string, at?: Date | null) => string
> = {
  en: (name, intake, stage, at) =>
    `${name}: ${stage} for ${intake}` +
    (at ? ` is on ${dateText('en', at)}.` : ' will be scheduled.'),
  bn: (name, intake, stage, at) =>
    `${name}: ${intake}-এর ${stage}` +
    (at ? ` ${dateText('bn', at)}-এ হবে।` : ' শীঘ্রই জানানো হবে।'),
};

/** What a published result tells the guardian. REJECTED is opt-in (D26). */
export type AdmissionResultOutcome = 'SELECTED' | 'WAITING' | 'PASSED' | 'NOT_PASSED' | 'REJECTED';

const RESULT: Record<
  TemplateLocale,
  Record<AdmissionResultOutcome, (name: string, intake: string) => string>
> = {
  en: {
    SELECTED: (n, i) =>
      `Congratulations! ${n} is selected for ${i}. Please contact the school office.`,
    WAITING: (n, i) => `${n} is on the waiting list for ${i}. We will contact you if a seat opens.`,
    PASSED: (n, i) => `${n} has passed the current round for ${i}. We will share the next step.`,
    NOT_PASSED: (n, i) => `${n} did not pass the current round for ${i}. Thank you for applying.`,
    REJECTED: (n, i) => `Thank you for applying. ${n}'s application for ${i} was not successful.`,
  },
  bn: {
    SELECTED: (n, i) => `অভিনন্দন! ${i}-এ ${n} নির্বাচিত হয়েছে। স্কুল অফিসে যোগাযোগ করুন।`,
    WAITING: (n, i) => `${i}-এ ${n} অপেক্ষমাণ তালিকায় আছে। আসন খালি হলে জানানো হবে।`,
    PASSED: (n, i) => `${i}-এর এই ধাপে ${n} উত্তীর্ণ হয়েছে। পরের ধাপ জানানো হবে।`,
    NOT_PASSED: (n, i) => `${i}-এর এই ধাপে ${n} উত্তীর্ণ হয়নি। আবেদনের জন্য ধন্যবাদ।`,
    REJECTED: (n, i) => `আবেদনের জন্য ধন্যবাদ। ${i}-এ ${n}-এর আবেদন সফল হয়নি।`,
  },
};

export const resultBody = (
  locale: TemplateLocale,
  outcome: AdmissionResultOutcome,
  name: string,
  intake: string,
) => RESULT[locale][outcome](name, intake);
export const listOfferBody = (
  locale: TemplateLocale,
  name: string,
  intake: string,
  deadline?: Date | null,
) => LIST_OFFER[locale](name, intake, deadline);

/**
 * [27.7] Thin producer for admission status-change notifications — reuses
 * the same `CommunicationLog` + `COMMUNICATIONS_QUEUE` mechanism every
 * other channel in the app goes through (see
 * `docs/architecture/05-communications.md` and
 * `AbsenceNoticeService.queueRecipients`, the closest existing precedent
 * for an automated, staff-action-triggered send).
 *
 * ponytail: applicants aren't linked to a real `Guardian` row before
 * ADMITTED, so there's no `preferred_communication`/opt-out to consult yet
 * — sends SMS only, to `guardian_phone` (always present). Widen to
 * guardian preference once applicants carry a `guardian_id`.
 */
@Injectable()
export class AdmissionNotificationService {
  private readonly logger = new Logger(AdmissionNotificationService.name);

  constructor(
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    @InjectQueue(COMMUNICATIONS_QUEUE)
    private readonly queue: Queue,
    private readonly smsCreditService: SmsCreditService,
  ) {}

  async notifyStatusChange(
    applicant: Pick<
      AdmissionApplicant,
      'id' | 'tenant_id' | 'applicant_name' | 'guardian_name' | 'guardian_phone' | 'status'
    >,
    intakeTitle: string,
  ): Promise<void> {
    // PENDING or any other status — nothing to notify about
    if (!TEMPLATE_BY_STATUS.en[applicant.status]) return;
    await this.sendSms(
      applicant,
      (locale) =>
        TEMPLATE_BY_STATUS[locale][applicant.status]!(applicant.applicant_name, intakeTitle),
      { applicant_id: applicant.id, admission_status: applicant.status },
    );
  }

  /** One SMS to the guardian: locale, log row, credit reserve, enqueue. Never rejects on delivery. */
  private async sendSms(
    applicant: NotifyApplicant,
    body: (locale: TemplateLocale) => string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    // No module change: read the school through the log repo's manager.
    const school = await this.logRepo.manager.findOne(School, {
      where: { id: applicant.tenant_id },
      select: { id: true, settings: true },
    });
    // No stored locale resolves to the bn-BD default (#3136).
    const locale = resolveTemplateLocale(school?.settings?.region?.locale);

    const log = await this.logRepo.save(
      this.logRepo.create({
        tenant_id: applicant.tenant_id,
        medium: CommunicationMedium.SMS,
        recipient_address: applicant.guardian_phone,
        recipient_name: applicant.guardian_name,
        message_body: body(locale),
        status: CommunicationStatus.QUEUED,
        trigger: CommunicationTrigger.AUTOMATED,
        sent_by_user_id: null,
        metadata,
      }),
    );

    // [#2216] Metered SMS must hold credit before it is queued. A reserve
    // that throws fails the log rather than leaving it QUEUED with no job.
    const credit = await this.smsCreditService
      .reserveForLog(applicant.tenant_id, log)
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to reserve SMS credit for admission log ${log.id}: ${String(error)}`,
        );
        return CREDIT_RESERVE_FAILED;
      });
    if (typeof credit === 'string') {
      log.status = CommunicationStatus.FAILED;
      log.metadata = {
        ...log.metadata,
        reason: credit === 'INSUFFICIENT' ? INSUFFICIENT_SMS_CREDIT : credit,
      };
      await this.logRepo.save(log);
      return;
    }

    try {
      await this.queue.add('send', { logId: log.id, ...credit });
    } catch (error) {
      if (credit.segments !== undefined) {
        await this.smsCreditService.releaseForLog(applicant.tenant_id, log.id, credit.segments);
      }
      this.logger.warn(
        `Failed to enqueue admission status-change notification ${log.id} for applicant ${applicant.id}: ${String(error)}`,
      );
      log.status = CommunicationStatus.FAILED;
      log.metadata = { ...log.metadata, error: 'Failed to enqueue for delivery' };
      await this.logRepo.save(log);
    }
  }

  // Wave 2 no-op hooks (#4176): final signatures so later tickets never edit call sites.
  // #4178 fills notifyFeeSentBack; #4182/#4183 notifyListOffer; #4179 notifyStageSchedule;
  // #4180/#4184 notifyResult.
  async notifyFeeSentBack(
    applicant: NotifyApplicant,
    intakeTitle: string,
    reason: string,
  ): Promise<void> {
    await this.sendSms(
      applicant,
      (locale) => FEE_SENT_BACK[locale](applicant.applicant_name, intakeTitle, reason),
      { applicant_id: applicant.id, admission_event: 'FEE_SENT_BACK' },
    );
  }

  async notifyListOffer(
    applicant: NotifyApplicant,
    intakeTitle: string,
    deadline?: Date | null,
  ): Promise<void> {
    await this.sendSms(
      applicant,
      (locale) => LIST_OFFER[locale](applicant.applicant_name, intakeTitle, deadline),
      { applicant_id: applicant.id, admission_event: 'LIST_OFFER' },
    );
  }

  async notifyStageSchedule(
    applicant: NotifyApplicant,
    intakeTitle: string,
    stageName: string,
    scheduledAt?: Date | null,
  ): Promise<void> {
    await this.sendSms(
      applicant,
      (locale) =>
        STAGE_SCHEDULE[locale](applicant.applicant_name, intakeTitle, stageName, scheduledAt),
      { applicant_id: applicant.id, admission_event: 'STAGE_SCHEDULE' },
    );
  }

  async notifyResult(
    applicant: NotifyApplicant,
    intakeTitle: string,
    outcome: AdmissionResultOutcome,
  ): Promise<void> {
    await this.sendSms(
      applicant,
      (locale) => resultBody(locale, outcome, applicant.applicant_name, intakeTitle),
      { applicant_id: applicant.id, admission_event: 'RESULT', outcome },
    );
  }

  /** Locale the school's SMS go out in (same rule as `sendSms`). */
  async localeFor(tenantId: string): Promise<TemplateLocale> {
    const school = await this.logRepo.manager.findOne(School, {
      where: { id: tenantId },
      select: { id: true, settings: true },
    });
    return resolveTemplateLocale(school?.settings?.region?.locale);
  }
}
