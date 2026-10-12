import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, EntityManager, Not, In } from 'typeorm';
import {
  AdmissionApplicantStatus,
  AdmissionDocumentType,
  AdmissionEvaluationDecision,
  AuditAction,
  type AdmissionGuardianMatchDto,
} from '@biddaloy/shared';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { AdmissionEvaluation } from './entities/admission-evaluation.entity';
import { AdmissionIntake } from './entities/admission-intake.entity';
import { StudentService, GuardianService } from '../students/students.service';
import { Guardian } from '../students/entities/guardian.entity';
import { EvaluateApplicantDto } from './dto/evaluate-applicant.dto';
import { AdmitApplicantDto } from './dto/admit-applicant.dto';
import { AdmissionNotificationService } from './admission-notification.service';
import { ListApplicantsDto } from './dto/list-applicants.dto';
import { bdPhoneTail } from '../communications/providers/shared/phone-number.util';
import { StorageService, type StoredObject } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../../common/request-context.util';

const DECISION_TO_STATUS: Record<AdmissionEvaluationDecision, AdmissionApplicantStatus> = {
  SHORTLIST: AdmissionApplicantStatus.SHORTLISTED,
  ADMIT: AdmissionApplicantStatus.ADMITTED,
  REJECT: AdmissionApplicantStatus.REJECTED,
};

/** [27.5] Staff review of `admission_applicants`: evaluate, admit (converts
 * to a real Student + Guardian via `GuardianService.findByPhoneAnyFormat`/
 * `.create`, see D7), or reject. */
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
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
  ) {}

  /** [PUB-05] The bytes of one uploaded document. 404 across tenants or when absent. */
  async getDocument(
    id: string,
    type: AdmissionDocumentType,
    tenantId: string,
  ): Promise<StoredObject> {
    const applicant = await this.findOne(id, tenantId);
    const doc = applicant.documents.find((d) => d.type === type);
    if (!doc) throw new NotFoundException('Document not found');
    return this.storage.getForTenant(doc.storage_key, tenantId);
  }

  /** [PUB-06] Clear a REJECTED applicant's documents: row, audit, then the storage objects. */
  async deleteDocuments(
    id: string,
    tenantId: string,
    userId: string,
    context: RequestContext,
  ): Promise<void> {
    const keys = await this.applicants.manager.transaction(async (manager: EntityManager) => {
      const repo = manager.getRepository(AdmissionApplicant);
      const applicant = await repo.findOne({
        where: { id, tenant_id: tenantId, deleted_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!applicant) throw new NotFoundException('Admission applicant not found');
      if (applicant.status !== AdmissionApplicantStatus.REJECTED) {
        throw new ConflictException({
          message: "Only a rejected applicant's documents can be deleted.",
          details: { code: 'APPLICANT_NOT_REJECTED' },
        });
      }
      await repo.update({ id, tenant_id: tenantId }, { documents: [] });
      // Types only: never keys or file contents in the audit row.
      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'AdmissionApplicantDocuments',
          entity_id: id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { types: applicant.documents.map((d) => d.type) },
          new_values: null,
        },
        manager,
      );
      return applicant.documents.map((d) => d.storage_key);
    });
    // Best-effort after commit: a dangling object is cheaper than a failed delete.
    await Promise.allSettled(keys.map((k) => this.storage.deleteForTenant(k, tenantId)));
  }

  /** [LIFE-09] The guardian (if any) this applicant's phone would attach to on admit. */
  async guardianMatch(id: string, tenantId: string): Promise<AdmissionGuardianMatchDto> {
    const applicant = await this.findOne(id, tenantId);
    const found = await this.guardianService.findByPhoneAnyFormat(
      applicant.guardian_phone,
      tenantId,
    );
    if (!found) return { guardian: null };
    return {
      guardian: {
        id: found.id,
        full_name: found.full_name,
        phone: found.phone ?? applicant.guardian_phone,
        student_names: (found.students ?? []).filter((s) => !s.deleted_at).map((s) => s.full_name),
      },
    };
  }

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

    if (dto.decision) {
      // Conditioned on the status this method already verified above,
      // rather than trusting that read to still hold — otherwise a
      // concurrent admit() between the read and this write can flip the
      // applicant to ADMITTED while this update still lands, leaving a
      // SHORTLISTED/REJECTED status on an applicant a Student record
      // already exists for.
      const allowedFrom =
        dto.decision === 'SHORTLIST'
          ? AdmissionApplicantStatus.PENDING
          : Not(In([AdmissionApplicantStatus.ADMITTED, AdmissionApplicantStatus.REJECTED]));
      const result = await this.applicants.update(
        { id, tenant_id: tenantId, status: allowedFrom },
        { status: DECISION_TO_STATUS[dto.decision] },
      );
      if (result.affected === 0) {
        throw new ConflictException('Applicant status changed concurrently — please retry');
      }
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

    // Conditioned on the status just verified, not trusted to still hold —
    // see the matching comment in evaluate().
    const result = await this.applicants.update(
      {
        id,
        tenant_id: tenantId,
        status: Not(In([AdmissionApplicantStatus.ADMITTED, AdmissionApplicantStatus.REJECTED])),
      },
      { status: AdmissionApplicantStatus.REJECTED },
    );
    if (result.affected === 0) {
      throw new ConflictException('Applicant status changed concurrently — please retry');
    }

    await this.evaluations.save(
      this.evaluations.create({
        tenant_id: tenantId,
        applicant_id: id,
        reviewer_user_id: reviewerUserId,
        notes: notes ?? 'Rejected',
        decision: 'REJECT',
      }),
    );
    const updated = await this.findOne(id, tenantId);
    await this.notifyStatusChange(updated);
    return updated;
  }

  /** Admits from PENDING or SHORTLISTED (D6). Resolves/creates the guardian
   * by phone (same any-format lookup as `guardianMatch()`), creates the Student
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

      const existingGuardian = await this.guardianService.findByPhoneAnyFormat(
        applicant.guardian_phone,
        tenantId,
        manager,
      );
      // [LIFE-09] A phone match is never linked silently: staff pick link or create-new.
      if (existingGuardian && !dto.guardian_choice) {
        throw new ConflictException({
          message:
            'This phone number belongs to an existing guardian. Choose whether to link this child to that family or create a new guardian.',
          details: { code: 'GUARDIAN_MATCH_NEEDS_CHOICE', guardian_id: existingGuardian.id },
        });
      }
      // Phones are not unique (CREATE_NEW makes a second guardian on the same
      // phone), so link exactly the guardian staff were shown, never "a" match.
      const candidate =
        dto.guardian_choice === 'LINK_EXISTING' && dto.guardian_id
          ? await manager.getRepository(Guardian).findOne({
              where: { id: dto.guardian_id, tenant_id: tenantId, deleted_at: IsNull() },
            })
          : null;
      const shownGuardian =
        candidate && bdPhoneTail(candidate.phone ?? '') === bdPhoneTail(applicant.guardian_phone)
          ? candidate
          : null;
      if (dto.guardian_choice === 'LINK_EXISTING' && !shownGuardian) {
        throw new ConflictException({
          message: 'The matching guardian changed. Reload and choose again.',
          details: { code: 'GUARDIAN_MATCH_CHANGED' },
        });
      }
      const linked = !!shownGuardian;
      const guardianId = shownGuardian
        ? shownGuardian.id
        : (
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
        { userId: reviewerUserId },
      );

      await manager.getRepository(AdmissionEvaluation).save(
        manager.getRepository(AdmissionEvaluation).create({
          tenant_id: tenantId,
          applicant_id: id,
          reviewer_user_id: reviewerUserId,
          notes: dto.notes ?? (linked ? 'Admitted (linked to existing guardian)' : 'Admitted'),
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
