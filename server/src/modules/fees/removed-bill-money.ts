import { EntityManager, In } from 'typeorm';
import { WalletTransactionKind } from '@biddaloy/shared';
import { StudentFee } from './entities/student-fee.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { WalletService } from './wallet.service';

export interface RemovedBillCredit {
  student_fee_id: string;
  payment_id: string;
  amount: number;
}

/**
 * Everything that must happen to money when bills are removed (soft-deleted):
 *  1. generation-time wallet auto-apply (`DEBIT_GENERATION`) goes back to the
 *     wallet as a `REVERSAL` credit;
 *  2. checkout money (live payment allocations) is credited to the student's
 *     wallet as `CREDIT_BILL_REMOVED` (MON-03, D16).
 * Runs inside the caller's transaction. Student wallet rows are locked first,
 * so two concurrent removals serialize and the second sees the first's rows
 * (idempotent: one credit per payment + bill).
 */
export async function returnMoneyOfRemovedBills(
  manager: EntityManager,
  walletService: WalletService,
  bills: StudentFee[],
  tenantId: string,
  userId: string | null,
): Promise<RemovedBillCredit[]> {
  if (bills.length === 0) return [];
  const billIds = bills.map((b) => b.id);
  const studentByBill = new Map(bills.map((b) => [b.id, b.student_id]));

  const walletTxRepo = manager.getRepository(WalletTransaction);

  // Read what could need returning first, then lock only the wallets involved
  // (sorted) BEFORE reading the "already reversed / already credited" rows:
  // two concurrent removals serialize on the wallet and the second sees the
  // first's rows.
  const debits = await walletTxRepo.find({
    where: { student_fee_id: In(billIds), kind: WalletTransactionKind.DEBIT_GENERATION },
  });
  const allocations: Array<{
    payment_id: string;
    student_fee_id: string;
    allocated_amount: string;
  }> = await manager.query(
    `SELECT pa.payment_id, pa.student_fee_id, pa.allocated_amount
       FROM payment_allocations pa
       JOIN payments p ON p.id = pa.payment_id
      WHERE pa.student_fee_id = ANY($1::uuid[])
        AND p.reversal_of_payment_id IS NULL
        AND p.reversed_by_payment_id IS NULL
        AND p.deleted_at IS NULL
      ORDER BY pa.payment_id, pa.student_fee_id`,
    [billIds],
  );
  const needed = new Set<string>();
  for (const d of debits) {
    const sid = d.student_fee_id ? studentByBill.get(d.student_fee_id) : undefined;
    if (sid) needed.add(sid);
  }
  for (const a of allocations) {
    if (Number(a.allocated_amount) > 0) needed.add(studentByBill.get(a.student_fee_id)!);
  }
  for (const studentId of [...needed].sort()) {
    await walletService.getOrCreate(studentId, tenantId, manager);
  }
  const credits: RemovedBillCredit[] = [];

  // 1. Generation auto-apply returns to the wallet.
  if (debits.length > 0) {
    const alreadyReversed = new Set(
      (await walletTxRepo.find({ where: { reversal_of_id: In(debits.map((d) => d.id)) } })).map(
        (r) => r.reversal_of_id,
      ),
    );
    for (const debit of debits) {
      if (alreadyReversed.has(debit.id)) continue;
      const studentId = debit.student_fee_id ? studentByBill.get(debit.student_fee_id) : undefined;
      if (!studentId) continue;
      const amount = Math.abs(Number(debit.amount));
      if (amount <= 0) continue;
      await walletService.credit(
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

  // 2. Checkout money on the removed bills -> wallet credit.
  if (allocations.length === 0) return credits;

  const existing = await walletTxRepo.find({
    where: { kind: WalletTransactionKind.CREDIT_BILL_REMOVED, student_fee_id: In(billIds) },
  });
  const done = new Set(existing.map((t) => `${t.payment_id}:${t.student_fee_id}`));

  for (const a of allocations) {
    const amount = Number(a.allocated_amount);
    if (amount <= 0 || done.has(`${a.payment_id}:${a.student_fee_id}`)) continue;
    await walletService.credit(
      {
        studentId: studentByBill.get(a.student_fee_id)!,
        tenantId,
        amount,
        kind: WalletTransactionKind.CREDIT_BILL_REMOVED,
        paymentId: a.payment_id,
        studentFeeId: a.student_fee_id,
        createdByUserId: userId,
        note: 'Bill removed after payment',
      },
      manager,
    );
    credits.push({ student_fee_id: a.student_fee_id, payment_id: a.payment_id, amount });
  }
  return credits;
}
