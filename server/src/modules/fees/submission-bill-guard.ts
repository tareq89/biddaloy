import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PaymentSubmissionStatus } from '@biddaloy/shared';
import { PaymentSubmissionBill } from '../payment-submissions/entities/payment-submission-bill.entity';

/**
 * [3.x] A bill a guardian's PENDING submission points at must not be removed: the money
 * the guardian sent is meant for that bill. Counts only in the answer (Rule 23).
 * Call it inside the removal transaction, after the bill rows are locked.
 */
export async function assertNoWaitingSubmissionBills(
  manager: EntityManager,
  tenantId: string,
  billIds: string[],
): Promise<void> {
  if (billIds.length === 0) return;
  const rows: { id: string }[] = await manager
    .getRepository(PaymentSubmissionBill)
    .createQueryBuilder('b')
    .innerJoin('b.submission', 's')
    .select('b.submission_id', 'id')
    .where('b.student_fee_id IN (:...billIds)', { billIds })
    .andWhere('b.tenant_id = :tenantId', { tenantId })
    .andWhere('s.tenant_id = :tenantId', { tenantId })
    .andWhere('s.status = :status', { status: PaymentSubmissionStatus.PENDING })
    .distinct(true)
    .getRawMany();
  if (rows.length > 0) {
    throw new ConflictException({
      message: 'A payment waiting for review covers one of these bills',
      details: { code: 'PAYMENT_SUBMISSION_WAITING', count: rows.length },
    });
  }
}
