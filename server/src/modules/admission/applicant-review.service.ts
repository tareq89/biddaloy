import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
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
    @InjectRepository(AdmissionApplicant) private readonly applicants: Repository<AdmissionApplicant>,
    @InjectRepository(AdmissionEvaluation) private readonly evaluations: Repository<AdmissionEvaluation>,
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
      throw new BadRequestException('Use POST /admission/applicants/:id/admit to admit an applicant');
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

  async reject(id: string, tenantId: string, reviewerUserId: string, notes?: string): Promise<AdmissionApplicant> {
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
    await this.applicants.update({ id, tenant_id: tenantId }, { status: AdmissionApplicantStatus.REJECTED });
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

    // ponytail: read-check-then-write with no row lock — two concurrent
    // admit calls on the same applicant (or two applicants sharing a
    // guardian phone) can both pass the check and double-write. Add
    // `SELECT ... FOR UPDATE` on the applicant/guardian lookups here if
    // concurrent admits become a real scenario (staff review is low-volume
    // today).
    await this.applicants.manager.transaction(async (manager: EntityManager) => {
      const existingGuardian = await this.guardianService.findByPhone(
        applicant.guardian_phone,
        tenantId,
        manager,
      );
      const guardianId =
        existingGuardian?.id ??
        (
          await this.guardianService.create(
            { full_name: applicant.guardian_name, phone: applicant.guardian_phone, email: applicant.guardian_email ?? undefined },
            tenantId,
            manager,
            reviewerUserId,
          )
        ).id;

      const classSectionId = await this.intakeClassSectionId(applicant.intake_id, manager);
      await this.studentService.create(
        {
          full_name: applicant.applicant_name,
          class_section_id: classSectionId,
          date_of_birth: applicant.date_of_birth,
          gender: applicant.gender,
          home_address: applicant.home_address ?? undefined,
          guardian_ids: [guardianId],
        },
        tenantId,
        manager,
      );

      await manager
        .getRepository(AdmissionEvaluation)
        .save(
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

  private async intakeClassSectionId(intakeId: string, manager: EntityManager): Promise<string> {
    const intake = await manager.getRepository(AdmissionIntake).findOne({ where: { id: intakeId } });
    if (!intake) throw new NotFoundException('Admission intake not found');
    return intake.class_section_id;
  }

  /** Best-effort — a notification failure must never fail the review
   * action itself (the status change already committed). */
  private async notifyStatusChange(applicant: AdmissionApplicant): Promise<void> {
    const intake = await this.applicants.manager
      .getRepository(AdmissionIntake)
      .findOne({ where: { id: applicant.intake_id } });
    try {
      await this.notificationService.notifyStatusChange(applicant, intake?.title ?? 'the admission intake');
    } catch {
      // best-effort: notificationService already logs the failure on the
      // CommunicationLog row; a review action must never fail because a
      // notification could not be sent.
    }
  }
}
