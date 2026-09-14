import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { AuditAction, ApprovalScope, WalletTransactionKind } from '@biddaloy/shared';
import { FeeGeneration } from './entities/fee-generation.entity';
import { StudentFee } from './entities/student-fee.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { Student } from '../students/entities/student.entity';
import { AuditService } from '../audit/audit.service';
import { WalletService } from './wallet.service';
import { ApprovalService } from '../auth/guards/approval.guard';
import { PatchFeeGenerationDto } from './dto/fee-generations.dto';

const EDIT_PAID_SCOPE = ApprovalScope.FEES_EDIT_PAID;

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  currentTenant?: { id: string };
  user?: { sub: string };
}

export interface RemoveUncollectedResult {
  removed_count: number;
}

/**
 * [16.3.2] Batch mutations: fix a batch that was generated wrong.
 *
 * Every mutation here soft-deletes (`StudentFee`/`FeeGeneration` both carry
 * `@DeleteDateColumn`) — never a hard delete — so `payment_allocations` and
 * `invoices` rows pointing at a removed bill never orphan: the parent row
 * just gets `deleted_at` stamped, the FK stays intact.
 *
 * "Free while nothing is collected, approval once money is involved" (the
 * issue's own goal line) is enforced the same way `FeeGenerationService`'s
 * own `CREATE_ANYWAY`/`REMOVE_OLDER`-over-a-paid-bill branches do: no
 * `@RequireApproval` decorator (this only *sometimes* needs approval), an
 * imperative `ApprovalService.consume(request, scope)` call instead, gated
 * on whether any bill in scope actually has money against it.
 */
@Injectable()
export class FeeGenerationBatchService {
  constructor(
    @InjectRepository(FeeGeneration)
    private readonly generationRepo: Repository<FeeGeneration>,
    @InjectRepository(StudentFee)
    private readonly studentFeeRepo: Repository<StudentFee>,
    private readonly auditService: AuditService,
    private readonly walletService: WalletService,
    private readonly approvalService: ApprovalService,
  ) {}

  async patch(
    id: string,
    dto: PatchFeeGenerationDto,
    tenantId: string,
    userId: string | null,
    request: RequestLike,
  ): Promise<void> {
    const batch = await this.findBatch(id, tenantId);

    const newPeriodStart = dto.period_start ? new Date(dto.period_start) : batch.period_start;
    const newPeriodType = dto.period_type ?? batch.period_type;
    const newDueDate = dto.due_date ? new Date(dto.due_date) : batch.due_date;

    await this.studentFeeRepo.manager.transaction(async (manager) => {
      const bills = await manager
        .getRepository(StudentFee)
        .find({ where: { fee_generation_id: batch.id } });
      const billIds = bills.map((b) => b.id);

      // Only the period_start move can actually collide with the
      // (student_id, fee_structure_id, period_start, occurrence) unique
      // constraint — period_type/due_date changes never do.
      if (dto.period_start && billIds.length > 0) {
        const structureIds = [...new Set(bills.map((b) => b.fee_structure_id))];
        const occurrences = [...new Set(bills.map((b) => b.occurrence))];

        const candidateRows = await manager
          .getRepository(StudentFee)
          .createQueryBuilder('sf')
          .leftJoin(Student, 's', 's.id = sf.student_id')
          .where('sf.id NOT IN (:...billIds)', { billIds })
          .andWhere('sf.deleted_at IS NULL')
          .andWhere('sf.fee_structure_id IN (:...structureIds)', { structureIds })
          .andWhere('sf.occurrence IN (:...occurrences)', { occurrences })
          .andWhere('sf.period_start = :newPeriodStart', { newPeriodStart })
          .select('sf.student_id', 'student_id')
          .addSelect('sf.fee_structure_id', 'fee_structure_id')
          .addSelect('sf.occurrence', 'occurrence')
          .addSelect('s.full_name', 'full_name')
          .getRawMany<{
            student_id: string;
            fee_structure_id: string;
            occurrence: number;
            full_name: string;
          }>();

        // Only an *exact* (student, structure, occurrence) match against
        // one of this batch's own bills is a real collision — a same-period
        // bill for a different structure/occurrence isn't.
        const billKeys = new Set(
          bills.map((b) => `${b.student_id}:${b.fee_structure_id}:${b.occurrence}`),
        );
        const conflictRows = candidateRows.filter((row) =>
          billKeys.has(`${row.student_id}:${row.fee_structure_id}:${row.occurrence}`),
        );

        if (conflictRows.length > 0) {
          const seen = new Set<string>();
          const students: Array<{ id: string; full_name: string }> = [];
          for (const row of conflictRows) {
            if (seen.has(row.student_id)) continue;
            seen.add(row.student_id);
            students.push({ id: row.student_id, full_name: row.full_name });
          }
          throw new ConflictException({
            message: 'Period change conflicts with existing bills for these students',
            details: { students },
          });
        }
      }

      const collected = await this.anyCollected(manager, billIds);
      let approvedBy: string | null = null;
      if (collected) {
        const approval = await this.approvalService.consume(request, EDIT_PAID_SCOPE);
        approvedBy = approval.approverId;
      }

      if (billIds.length > 0) {
        await manager.getRepository(StudentFee).update(
          { id: In(billIds) },
          {
            period_start: newPeriodStart,
            period_type: newPeriodType,
            due_date: newDueDate,
          },
        );
      }
      await manager
        .getRepository(FeeGeneration)
        .update(
          { id: batch.id },
          { period_start: newPeriodStart, period_type: newPeriodType, due_date: newDueDate },
        );

      const auditEntry = {
        entity_type: 'FeeGeneration' as const,
        entity_id: batch.id,
        tenant_id: tenantId,
        performed_by_user_id: userId,
        old_values: {
          period_start: batch.period_start,
          period_type: batch.period_type,
          due_date: batch.due_date,
        },
        new_values: {
          period_start: newPeriodStart,
          period_type: newPeriodType,
          due_date: newDueDate,
          bill_count: billIds.length,
        },
      };
      if (collected && approvedBy) {
        await this.auditService.recordApproved(
          {
            ...auditEntry,
            action: AuditAction.UPDATE,
            approved_by_user_id: approvedBy,
            approval_scope: EDIT_PAID_SCOPE,
          },
          manager,
        );
      } else {
        await this.auditService.record({ ...auditEntry, action: AuditAction.UPDATE }, manager);
      }
    });
  }

  async deleteBatch(
    id: string,
    tenantId: string,
    userId: string | null,
    request: RequestLike,
  ): Promise<void> {
    const batch = await this.findBatch(id, tenantId);

    await this.studentFeeRepo.manager.transaction(async (manager) => {
      const bills = await manager
        .getRepository(StudentFee)
        .find({ where: { fee_generation_id: batch.id } });
      const billIds = bills.map((b) => b.id);

      const collected = await this.anyCollected(manager, billIds);
      let approvedBy: string | null = null;
      if (collected) {
        const approval = await this.approvalService.consume(request, EDIT_PAID_SCOPE);
        approvedBy = approval.approverId;
      }

      if (billIds.length > 0) {
        await manager.getRepository(StudentFee).softDelete({ id: In(billIds) });
      }
      await manager.getRepository(FeeGeneration).softDelete({ id: batch.id });

      await this.reverseWalletDebits(manager, bills, tenantId, userId);

      const auditEntry = {
        entity_type: 'FeeGeneration' as const,
        entity_id: batch.id,
        tenant_id: tenantId,
        performed_by_user_id: userId,
        new_values: { removed_bill_ids: billIds, removed_count: billIds.length },
      };
      if (collected && approvedBy) {
        await this.auditService.recordApproved(
          {
            ...auditEntry,
            action: AuditAction.DELETE,
            approved_by_user_id: approvedBy,
            approval_scope: EDIT_PAID_SCOPE,
          },
          manager,
        );
      } else {
        await this.auditService.record({ ...auditEntry, action: AuditAction.DELETE }, manager);
      }
    });
  }

  async removeStudent(
    id: string,
    studentId: string,
    tenantId: string,
    userId: string | null,
    request: RequestLike,
  ): Promise<void> {
    const batch = await this.findBatch(id, tenantId);

    await this.studentFeeRepo.manager.transaction(async (manager) => {
      const bills = await manager
        .getRepository(StudentFee)
        .find({ where: { fee_generation_id: batch.id, student_id: studentId } });
      const billIds = bills.map((b) => b.id);

      const collected = await this.anyCollected(manager, billIds);
      let approvedBy: string | null = null;
      if (collected) {
        const approval = await this.approvalService.consume(request, EDIT_PAID_SCOPE);
        approvedBy = approval.approverId;
      }

      if (billIds.length > 0) {
        await manager.getRepository(StudentFee).softDelete({ id: In(billIds) });
        await manager
          .getRepository(FeeGeneration)
          .increment({ id: batch.id }, 'removed_count', billIds.length);
      }

      await this.reverseWalletDebits(manager, bills, tenantId, userId);

      const auditEntry = {
        entity_type: 'FeeGeneration' as const,
        entity_id: batch.id,
        tenant_id: tenantId,
        performed_by_user_id: userId,
        new_values: {
          student_id: studentId,
          removed_bill_ids: billIds,
          removed_count: billIds.length,
        },
      };
      if (collected && approvedBy) {
        await this.auditService.recordApproved(
          {
            ...auditEntry,
            action: AuditAction.DELETE,
            approved_by_user_id: approvedBy,
            approval_scope: EDIT_PAID_SCOPE,
          },
          manager,
        );
      } else {
        await this.auditService.record({ ...auditEntry, action: AuditAction.DELETE }, manager);
      }
    });
  }

  /** No approval — only ever touches bills nobody has paid anything on. */
  async removeUncollected(
    id: string,
    tenantId: string,
    userId: string | null,
  ): Promise<RemoveUncollectedResult> {
    const batch = await this.findBatch(id, tenantId);
    let removedCount = 0;

    await this.studentFeeRepo.manager.transaction(async (manager) => {
      const candidates = await manager
        .getRepository(StudentFee)
        .find({ where: { fee_generation_id: batch.id, paid_amount: 0 } });
      if (candidates.length === 0) return;

      const candidateIds = candidates.map((b) => b.id);
      const allocated = await manager
        .getRepository(PaymentAllocation)
        .find({ where: { student_fee_id: In(candidateIds) } });
      const allocatedIds = new Set(allocated.map((a) => a.student_fee_id));
      const removableIds = candidateIds.filter((cid) => !allocatedIds.has(cid));
      if (removableIds.length === 0) return;

      await manager.getRepository(StudentFee).softDelete({ id: In(removableIds) });
      removedCount = removableIds.length;
      await manager
        .getRepository(FeeGeneration)
        .increment({ id: batch.id }, 'removed_count', removableIds.length);

      await this.auditService.record(
        {
          action: AuditAction.DELETE,
          entity_type: 'FeeGeneration',
          entity_id: batch.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          new_values: { removed_bill_ids: removableIds, removed_count: removableIds.length },
        },
        manager,
      );
    });

    return { removed_count: removedCount };
  }

  private async findBatch(id: string, tenantId: string): Promise<FeeGeneration> {
    const batch = await this.generationRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!batch) {
      throw new NotFoundException(`Fee generation batch "${id}" not found`);
    }
    return batch;
  }

  /** True if any of these bills has money against it — a payment or wallet
   * auto-apply (`paid_amount > 0`) or a payment allocation pointing at it
   * (kept even if `paid_amount` was later reset). */
  private async anyCollected(manager: EntityManager, billIds: string[]): Promise<boolean> {
    if (billIds.length === 0) return false;
    const paidCount = await manager
      .getRepository(StudentFee)
      .createQueryBuilder('sf')
      .where('sf.id IN (:...billIds)', { billIds })
      .andWhere('sf.paid_amount > 0')
      .getCount();
    if (paidCount > 0) return true;
    return manager
      .getRepository(PaymentAllocation)
      .exists({ where: { student_fee_id: In(billIds) } });
  }

  /**
   * Undoes every `DEBIT_GENERATION` wallet movement tied to `bills` — the
   * auto-apply `FeeGenerationService.generate` performed when it created
   * them — crediting the money back to each student's wallet with a
   * `REVERSAL` transaction linked to the original (D per the issue's
   * "wallet auto-applied money returns to the wallet on removal"
   * acceptance line). A payment made through checkout is untouched: that
   * money lives in `payment_allocations`, which stays pointing at the
   * now-soft-deleted bill, exactly as the plan asks.
   */
  private async reverseWalletDebits(
    manager: EntityManager,
    bills: StudentFee[],
    tenantId: string,
    userId: string | null,
  ): Promise<void> {
    if (bills.length === 0) return;
    const billIds = bills.map((b) => b.id);
    const studentByBill = new Map(bills.map((b) => [b.id, b.student_id]));

    const debits = await manager.getRepository(WalletTransaction).find({
      where: { student_fee_id: In(billIds), kind: WalletTransactionKind.DEBIT_GENERATION },
    });
    if (debits.length === 0) return;

    // Lock every affected student's wallet row *before* deciding what's
    // already reversed: two concurrent deletes of the same batch (or of
    // overlapping batches for the same student) would otherwise both read
    // "not yet reversed" under READ COMMITTED and double-credit the
    // wallet. `getOrCreate`'s `SELECT ... FOR UPDATE` serializes them —
    // the second call blocks until the first transaction commits, then
    // this manager's fresh read of `wallet_transactions` (below) sees the
    // `REVERSAL` row the first transaction just wrote.
    const studentIds = [...new Set(bills.map((b) => b.student_id))];
    for (const studentId of studentIds) {
      await this.walletService.getOrCreate(studentId, tenantId, manager);
    }

    const alreadyReversed = new Set(
      (
        await manager
          .getRepository(WalletTransaction)
          .find({ where: { reversal_of_id: In(debits.map((d) => d.id)) } })
      ).map((r) => r.reversal_of_id),
    );

    for (const debit of debits) {
      if (alreadyReversed.has(debit.id)) continue;
      const studentId = debit.student_fee_id ? studentByBill.get(debit.student_fee_id) : undefined;
      if (!studentId) continue;
      const amount = Math.abs(Number(debit.amount));
      if (amount <= 0) continue;

      await this.walletService.credit(
        {
          studentId,
          tenantId: debit.tenant_id,
          amount,
          kind: WalletTransactionKind.REVERSAL,
          studentFeeId: debit.student_fee_id,
          reversalOfId: debit.id,
          createdByUserId: userId,
        },
        manager,
      );
    }
  }
}
