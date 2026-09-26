import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, EntityManager } from 'typeorm';
import { AdmissionApplicantStatus, AdmissionEvaluationDecision } from '@biddaloy/shared';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { AdmissionEvaluation } from './entities/admission-evaluation.entity';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { StudentService, GuardianService } from '../students/students.service';
import { EvaluateApplicantDto } from './dto/evaluate-applicant.dto';
import { AdmitApplicantDto } from './dto/admit-applicant.dto';
import { AdmissionNotificationService } from './admission-notification.service';
import { ListApplicantsDto } from './dto/list-applicants.dto';

const DECISION_TO_STATUS: Record<AdmissionEvaluationDecision, AdmissionApplicantStatus> = {
  SHORTLIST: AdmissionApplicantStatus.SHORTLISTED,
  ADMIT: AdmissionApplicantStatus.ADMITTED,
  REJECT: AdmissionApplicantStatus.REJECTED,
};

/** [27.5] Staff review of `admission_applicants`: evaluate, admit (converts
 * to a real Student + Guardian, reusing `GuardianService.findByPhone`/
 * `.create` — the same calls `bulk-upload.service.ts`'s `resolveGuardian()`
 * makes, see D7), or reject. */
@Injectable()
export class ApplicantReviewService {
  constructor(
    @InjectRepository(AdmissionApplicant)
    private readonly applicants: Repository<AdmissionApplicant>,
    @InjectRepository(AdmissionEvaluation)
    private readonly evaluations: Repository<AdmissionEvaluation>,
    private readonly studentService: StudentService,
    private readonly guardianService: GuardianService,
    private readonly notificationService: AdmissionNotificationService,
  ) {}

  private async findOne(id: string, tenantId: string): Promise<AdmissionApplicant> {
    const applicant = await this.applicants.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!applicant) throw new NotFoundException('Admission applicant not found');
    return applicant;
  }

  private assertMutable(applicant: AdmissionApplicant): void {
    if (applicant.status === AdmissionApplicantStatus.ADMITTED) {
      throw new ConflictException('Applicant is already admitted and cannot be modified');
    }
    if (applicant.status === AdmissionApplicantStatus.REJECTED) {
      throw new ConflictException('Applicant is already rejected and cannot be modified');
    }
  }

  /** Records an evaluation row and, when a decision is given, moves the
   * applicant to SHORTLISTED/REJECTED. `decision: 'ADMIT'` is rejected here
   * — admitting creates student/guardian records and goes through `admit()`. */
  async evaluate(
    id: string,
    dto: EvaluateApplicantDto,
    tenantId: string,
    reviewerUserId: string,
  ): Promise<AdmissionApplicant> {
    const applicant = await this.findOne(id, tenantId);
    this.assertMutable(applicant);

    if (dto.decision === 'ADMIT') {
      throw new BadRequestException(
        'Use POST /admission/applicants/:id/admit to admit an applicant',
      );
    }
    if (dto.decision === 'SHORTLIST' && applicant.status !== AdmissionApplicantStatus.PENDING) {
      // Otherwise a second SHORTLIST decision on an already-SHORTLISTED
      // applicant re-saves and re-notifies the guardian for no real status
      // change.
      throw new ConflictException('Only a pending applicant can be shortlisted');
    }

    await this.evaluations.save(
      this.evaluations.create({
        tenant_id: tenantId,
        applicant_id: id,
        reviewer_user_id: reviewerUserId,
        notes: dto.notes,
        decision: dto.decision ?? null,
      }),
    );

    if (dto.decision) {
      await this.applicants.update(
        { id, tenant_id: tenantId },
        { status: DECISION_TO_STATUS[dto.decision] },
      );
    }
    const updated = await this.findOne(id, tenantId);
    if (dto.decision) await this.notifyStatusChange(updated);
    return updated;
  }

  async reject(
    id: string,
    tenantId: string,
    reviewerUserId: string,
    notes?: string,
  ): Promise<AdmissionApplicant> {
    const applicant = await this.findOne(id, tenantId);
    this.assertMutable(applicant);

    await this.evaluations.save(
      this.evaluations.create({
        tenant_id: tenantId,
        applicant_id: id,
        reviewer_user_id: reviewerUserId,
        notes: notes ?? 'Rejected',
        decision: 'REJECT',
      }),
    );
    await this.applicants.update(
      { id, tenant_id: tenantId },
      { status: AdmissionApplicantStatus.REJECTED },
    );
    const updated = await this.findOne(id, tenantId);
    await this.notifyStatusChange(updated);
    return updated;
  }

  /** Admits from PENDING or SHORTLISTED (D6). Resolves/creates the guardian
   * by phone (same lookup `resolveGuardian()` does), creates the Student
   * linked to the intake's class section, records an ADMIT evaluation, and
   * marks the applicant ADMITTED — all inside one transaction. */
  async admit(
    id: string,
    dto: AdmitApplicantDto,
    tenantId: string,
    reviewerUserId: string,
  ): Promise<AdmissionApplicant> {
    const applicant = await this.findOne(id, tenantId);
    this.assertMutable(applicant);
    if (
      applicant.status !== AdmissionApplicantStatus.PENDING &&
      applicant.status !== AdmissionApplicantStatus.SHORTLISTED
    ) {
      throw new ConflictException(`Cannot admit an applicant with status ${applicant.status}`);
    }

    await this.applicants.manager.transaction(async (manager: EntityManager) => {
      // Lock the intake row for the duration of the transaction — same
      // pattern as the public submission path's seat-count check — so two
      // concurrent admit calls can't both read "seats left" and both admit.
      const intake = await manager
        .getRepository(AdmissionIntake)
        .createQueryBuilder('intake')
        .setLock('pessimistic_write')
        .where('intake.id = :id AND intake.tenant_id = :tenantId', {
          id: applicant.intake_id,
          tenantId,
        })
        .getOne();
      if (!intake) throw new NotFoundException('Admission intake not found');

      const admittedCount = await manager.getRepository(AdmissionApplicant).count({
        where: {
          tenant_id: tenantId,
          intake_id: intake.id,
          status: AdmissionApplicantStatus.ADMITTED,
        },
      });
      if (admittedCount >= intake.seat_count) {
        throw new ConflictException('This intake has no seats left');
      }

      // Re-read status under the intake lock, closing the race a second
      // concurrent admit call on the same applicant could otherwise win.
      const current = await manager
        .getRepository(AdmissionApplicant)
        .findOne({ where: { id, tenant_id: tenantId, deleted_at: IsNull() } });
      if (!current) throw new NotFoundException('Admission applicant not found');
      if (
        current.status !== AdmissionApplicantStatus.PENDING &&
        current.status !== AdmissionApplicantStatus.SHORTLISTED
      ) {
        throw new ConflictException(`Cannot admit an applicant with status ${current.status}`);
      }

      const existingGuardian = await this.guardianService.findByPhone(
        applicant.guardian_phone,
        tenantId,
        manager,
      );
      const guardianId =
        existingGuardian?.id ??
        (
          await this.guardianService.create(
            {
              full_name: applicant.guardian_name,
              phone: applicant.guardian_phone,
              email: applicant.guardian_email ?? undefined,
            },
            tenantId,
            manager,
            reviewerUserId,
          )
        ).id;

      await this.studentService.create(
        {
          full_name: applicant.applicant_name,
          class_section_id: intake.class_section_id,
          date_of_birth: applicant.date_of_birth,
          gender: applicant.gender,
          home_address: applicant.home_address ?? undefined,
          guardian_ids: [guardianId],
        },
        tenantId,
        manager,
      );

      await manager.getRepository(AdmissionEvaluation).save(
        manager.getRepository(AdmissionEvaluation).create({
          tenant_id: tenantId,
          applicant_id: id,
          reviewer_user_id: reviewerUserId,
          notes: dto.notes ?? 'Admitted',
          decision: 'ADMIT',
        }),
      );

      await manager
        .getRepository(AdmissionApplicant)
        .update({ id, tenant_id: tenantId }, { status: AdmissionApplicantStatus.ADMITTED });
    });

    const updated = await this.findOne(id, tenantId);
    await this.notifyStatusChange(updated);
    return updated;
  }

  /** Best-effort — a notification failure must never fail the review
   * action itself (the status change already committed). */
  private async notifyStatusChange(applicant: AdmissionApplicant): Promise<void> {
    const intake = await this.applicants.manager
      .getRepository(AdmissionIntake)
      .findOne({ where: { id: applicant.intake_id } });
    try {
      await this.notificationService.notifyStatusChange(
        applicant,
        intake?.title ?? 'the admission intake',
      );
    } catch {
      // best-effort: notificationService already logs the failure on the
      // CommunicationLog row; a review action must never fail because a
      // notification could not be sent.
    }
  }

  /** [27.10] Tenant-scoped applicant list for the staff screen, optionally
   * filtered by intake and/or status. */
  async list(tenantId: string, filters: ListApplicantsDto): Promise<AdmissionApplicant[]> {
    return this.applicants.find({
      where: {
        tenant_id: tenantId,
        deleted_at: IsNull(),
        ...(filters.intakeId ? { intake_id: filters.intakeId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      order: { created_at: 'DESC' },
    });
  }

  /** [27.10] One applicant plus its evaluation history, newest first, for
   * the staff detail screen. */
  async findWithHistory(
    id: string,
    tenantId: string,
  ): Promise<{ applicant: AdmissionApplicant; evaluations: AdmissionEvaluation[] }> {
    const applicant = await this.findOne(id, tenantId);
    const evaluations = await this.evaluations.find({
      where: { applicant_id: id, tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });
    return { applicant, evaluations };
  }
}
