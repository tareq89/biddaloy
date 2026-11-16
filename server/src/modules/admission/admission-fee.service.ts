import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { AdmissionApplicantStatus, AdmissionFeeState, AuditAction } from '@biddaloy/shared';
import { isMissingObjectError } from '../schools/profile/logo.service';
import { StorageService, type StoredObject } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { AdmissionNotificationService } from './admission-notification.service';
import { AdmissionApplicant } from './entities/admission-applicant.entity';
import { AdmissionFeeProof } from './entities/admission-fee-proof.entity';
import { AdmissionIntake } from './entities/admission-intake.entity';
import type {
  FeeDecisionResponseDto,
  FeeProofListResponseDto,
  ListFeeProofsDto,
} from './dto/fee-decision.dto';

export interface FeeActor {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

/** [71.G1.03] Staff verify manual fee proofs: list, confirm, send back (D9, D13, D14, D16). */
@Injectable()
export class AdmissionFeeService {
  private readonly logger = new Logger(AdmissionFeeService.name);

  constructor(
    @InjectRepository(AdmissionFeeProof)
    private readonly proofs: Repository<AdmissionFeeProof>,
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
    private readonly notifications: AdmissionNotificationService,
  ) {}

  /** Paged proofs of this school, newest first, each with how many other proofs share its reference. */
  async list(tenantId: string, filters: ListFeeProofsDto): Promise<FeeProofListResponseDto> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const qb = this.proofs
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.applicant', 'a')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.deleted_at IS NULL')
      .andWhere('p.state = :state', { state: filters.state ?? AdmissionFeeState.AWAITING });
    if (filters.intakeId) qb.andWhere('a.intake_id = :intakeId', { intakeId: filters.intakeId });
    // `id` breaks created_at ties so a page boundary never repeats or skips a row.
    const [rows, total] = await qb
      .orderBy('p.created_at', 'DESC')
      .addOrderBy('p.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const refs = [...new Set(rows.map((r) => r.reference).filter((r): r is string => !!r))];
    const counts = new Map<string, number>();
    if (refs.length > 0) {
      const grouped = await this.proofs
        .createQueryBuilder('p')
        .select('p.reference', 'reference')
        .addSelect('COUNT(*)::int', 'c')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('p.reference IN (:...refs)', { refs })
        .groupBy('p.reference')
        .getRawMany<{ reference: string; c: number }>();
      for (const g of grouped) counts.set(g.reference, Number(g.c));
    }

    return {
      data: rows.map((r) => ({
        id: r.id,
        applicant_id: r.applicant_id,
        intake_id: r.applicant.intake_id,
        applicant_name: r.applicant.applicant_name,
        applicant_reference_number: r.applicant.reference_number,
        applicant_status: r.applicant.status,
        method: r.method,
        reference: r.reference,
        state: r.state,
        reason: r.reason,
        created_at: r.created_at.toISOString(),
        // The row itself is in the count; reference null gives 0.
        seen_before: r.reference ? Math.max((counts.get(r.reference) ?? 1) - 1, 0) : 0,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** The proof file. 404 across tenants or when the object is gone. */
  async getAttachment(id: string, tenantId: string): Promise<StoredObject> {
    const proof = await this.proofs.findOne({
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!proof) throw new NotFoundException('Fee proof not found');
    try {
      return await this.storage.getForTenant(proof.attachment_key, tenantId);
    } catch (error) {
      if (isMissingObjectError(error)) throw new NotFoundException('Fee proof not found');
      throw error;
    }
  }

  /**
   * Confirm: proof CONFIRMED, applicant leaves FEE_PENDING for PENDING. Duplicate protection
   * is the AWAITING guard under the row lock (a repeat gets 409), so no Idempotency-Key.
   */
  async confirm(id: string, tenantId: string, actor: FeeActor): Promise<FeeDecisionResponseDto> {
    return this.proofs.manager.transaction(async (manager) => {
      const { proof, applicant } = await this.lockAwaiting(manager, id, tenantId);
      const before = applicant.fee_state;
      proof.state = AdmissionFeeState.CONFIRMED;
      proof.verified_by_user_id = actor.userId;
      proof.reason = null;
      applicant.fee_state = AdmissionFeeState.CONFIRMED;
      applicant.status = AdmissionApplicantStatus.PENDING;
      await manager.save(proof);
      await manager.save(applicant);
      await this.audit(manager, tenantId, applicant.id, actor, before, {
        fee_state: AdmissionFeeState.CONFIRMED,
        proof_id: proof.id,
      });
      return this.result(proof, applicant);
    });
  }

  /** Send back: proof and fee_state SENT_BACK, applicant stays FEE_PENDING, guardian told after commit. */
  async sendBack(
    id: string,
    tenantId: string,
    reason: string,
    actor: FeeActor,
  ): Promise<FeeDecisionResponseDto> {
    const { out, applicant } = await this.proofs.manager.transaction(async (manager) => {
      const locked = await this.lockAwaiting(manager, id, tenantId);
      const { proof, applicant } = locked;
      const before = applicant.fee_state;
      proof.state = AdmissionFeeState.SENT_BACK;
      proof.verified_by_user_id = actor.userId;
      proof.reason = reason;
      applicant.fee_state = AdmissionFeeState.SENT_BACK;
      await manager.save(proof);
      await manager.save(applicant);
      // Audit carries ids and the reason only: no name, phone or file key.
      await this.audit(manager, tenantId, applicant.id, actor, before, {
        fee_state: AdmissionFeeState.SENT_BACK,
        proof_id: proof.id,
        reason,
      });
      return { out: this.result(proof, applicant), applicant };
    });

    // After commit: a failed SMS must not undo the decision.
    try {
      const intake = await this.proofs.manager.findOne(AdmissionIntake, {
        where: { id: applicant.intake_id, tenant_id: tenantId },
        select: { id: true, title: true },
      });
      await this.notifications.notifyFeeSentBack(applicant, intake?.title ?? '', reason);
    } catch (error) {
      this.logger.warn(`Fee send-back notification failed for proof ${id}: ${String(error)}`);
    }
    return out;
  }

  /** Lock proof then applicant (same order everywhere), require AWAITING and FEE_PENDING. */
  private async lockAwaiting(manager: EntityManager, id: string, tenantId: string) {
    const proof = await manager.findOne(AdmissionFeeProof, {
      where: { id, tenant_id: tenantId, deleted_at: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
    if (!proof) throw new NotFoundException('Fee proof not found');
    const applicant = await manager.findOne(AdmissionApplicant, {
      where: { id: proof.applicant_id, tenant_id: tenantId, deleted_at: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
    if (!applicant) throw new NotFoundException('Fee proof not found');
    if (proof.state !== AdmissionFeeState.AWAITING) {
      throw new ConflictException('This fee proof has already been decided.');
    }
    if (applicant.status !== AdmissionApplicantStatus.FEE_PENDING) {
      throw new ConflictException('This application is no longer waiting for a fee.');
    }
    return { proof, applicant };
  }

  private result(proof: AdmissionFeeProof, applicant: AdmissionApplicant): FeeDecisionResponseDto {
    return {
      proof_id: proof.id,
      applicant_id: applicant.id,
      fee_state: applicant.fee_state,
      status: applicant.status,
    };
  }

  private async audit(
    manager: EntityManager,
    tenantId: string,
    applicantId: string,
    actor: FeeActor,
    before: AdmissionFeeState,
    after: Record<string, unknown>,
  ) {
    await this.auditService.record(
      {
        action: AuditAction.UPDATE,
        entity_type: 'AdmissionApplicant',
        entity_id: applicantId,
        tenant_id: tenantId,
        performed_by_user_id: actor.userId,
        ip_address: actor.ip,
        user_agent: actor.userAgent,
        old_values: { fee_state: before },
        new_values: after,
      },
      manager,
    );
  }
}
