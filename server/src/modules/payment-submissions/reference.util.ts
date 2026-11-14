import type { EntityManager } from 'typeorm';

/** TrxID as compared everywhere: trimmed, upper-case. Empty becomes null. */
export function normaliseReference(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  return v === '' ? null : v;
}

export type DuplicateFlag = 'DUPLICATE_PAYMENT' | 'DUPLICATE_PENDING';

/**
 * D25: flags for the reviewer, never a refusal. A confirmed payment with the same TrxID wins over
 * another waiting proof. Counter entries hold raw text, so payments are compared in normalised
 * form too. `excludeSubmissionId` keeps a multi-child proof from flagging itself.
 */
export async function findDuplicateFlag(
  manager: EntityManager,
  tenantId: string,
  reference: string | null,
  excludeSubmissionId: string,
): Promise<DuplicateFlag | null> {
  if (!reference) return null;
  const [pay] = await manager.query(
    `SELECT 1 FROM payments
      WHERE tenant_id = $1 AND deleted_at IS NULL AND payment_status = 'SUCCESS'
        AND reversed_by_payment_id IS NULL AND reversal_of_payment_id IS NULL
        AND UPPER(TRIM(transaction_reference)) = $2 LIMIT 1`,
    [tenantId, reference],
  );
  if (pay) return 'DUPLICATE_PAYMENT';
  const [pending] = await manager.query(
    `SELECT 1 FROM payment_submissions
      WHERE tenant_id = $1 AND status = 'PENDING' AND reference_normalised = $2 AND id <> $3 LIMIT 1`,
    [tenantId, reference, excludeSubmissionId],
  );
  return pending ? 'DUPLICATE_PENDING' : null;
}
