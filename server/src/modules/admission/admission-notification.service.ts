import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AdmissionApplicantStatus, CommunicationMedium, CommunicationStatus, CommunicationTrigger } from '@biddaloy/shared';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { COMMUNICATIONS_QUEUE } from '../communications/communications.constants';
import { AdmissionApplicant } from './entities/admission-applicant.entity';

const TEMPLATE_BY_STATUS: Partial<Record<AdmissionApplicantStatus, (applicantName: string, intakeTitle: string) => string>> = {
  [AdmissionApplicantStatus.SHORTLISTED]: (name, intake) =>
    `Good news! ${name}'s application for ${intake} has been shortlisted. We will contact you with next steps.`,
  [AdmissionApplicantStatus.ADMITTED]: (name, intake) =>
    `Congratulations! ${name} has been admitted for ${intake}. Please contact the school office to complete enrollment.`,
  [AdmissionApplicantStatus.REJECTED]: (name, intake) =>
    `Thank you for applying. ${name}'s application for ${intake} was not successful this time.`,
};

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
  ) {}

  async notifyStatusChange(
    applicant: Pick<AdmissionApplicant, 'id' | 'tenant_id' | 'applicant_name' | 'guardian_name' | 'guardian_phone' | 'status'>,
    intakeTitle: string,
  ): Promise<void> {
    const template = TEMPLATE_BY_STATUS[applicant.status];
    if (!template) return; // PENDING or any other status — nothing to notify about

    const log = await this.logRepo.save(
      this.logRepo.create({
        tenant_id: applicant.tenant_id,
        medium: CommunicationMedium.SMS,
        recipient_address: applicant.guardian_phone,
        recipient_name: applicant.guardian_name,
        message_body: template(applicant.applicant_name, intakeTitle),
        status: CommunicationStatus.QUEUED,
        trigger: CommunicationTrigger.AUTOMATED,
        sent_by_user_id: null,
        metadata: { applicant_id: applicant.id, admission_status: applicant.status },
      }),
    );

    try {
      await this.queue.add('send', { logId: log.id });
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue admission status-change notification ${log.id} for applicant ${applicant.id}: ${String(error)}`,
      );
      log.status = CommunicationStatus.FAILED;
      log.metadata = { ...log.metadata, error: 'Failed to enqueue for delivery' };
      await this.logRepo.save(log);
    }
  }
}
