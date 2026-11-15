import { EntityManager } from 'typeorm';
import { AuditAction } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';

/**
 * [3.x D45] A payment a submission settled was reversed: mark the submission REVERSED and add
 * one history row per reversed payment (the payment id is in `note`). Runs INSIDE the reversal
 * transaction, so a failure here rolls the reversal back. Returns the submission ids that got a
 * new history row; the caller emits the REVERSED event for each after commit.
 */
export async function syncSubmissionsOnReversal(
  m: EntityManager,
  audit: AuditService,
  p: { tenantId: string; paymentId: string; actorUserId: string; reason: string },
): Promise<string[]> {
  const touched: string[] = [];
  const subs: { id: string }[] = await m.query(
    `SELECT DISTINCT s.id FROM payment_submission_bills b
       JOIN payment_submissions s ON s.id = b.submission_id AND s.tenant_id = $1
      WHERE b.payment_id = $2 AND b.tenant_id = $1 ORDER BY s.id`,
    [p.tenantId, p.paymentId],
  );
  for (const { id } of subs) {
    const [row] = await m.query(
      `SELECT status FROM payment_submissions WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [id, p.tenantId],
    );
    const note = `payment:${p.paymentId}`;
    const [dup] = await m.query(
      `SELECT 1 FROM payment_submission_events
        WHERE submission_id = $1 AND tenant_id = $2 AND to_status = 'REVERSED' AND note = $3`,
      [id, p.tenantId, note],
    );
    if (dup) continue;
    await m.query(
      `UPDATE payment_submissions SET status = 'REVERSED', updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [id, p.tenantId],
    );
    await m.query(
      `INSERT INTO payment_submission_events
         (tenant_id, submission_id, from_status, to_status, actor_user_id, reason_code, note)
       VALUES ($1,$2,$3,'REVERSED',$4,'PAYMENT_REVERSED',$5)`,
      [p.tenantId, id, row.status, p.actorUserId, note],
    );
    await audit.record(
      {
        action: AuditAction.UPDATE,
        entity_type: 'PaymentSubmission',
        entity_id: id,
        tenant_id: p.tenantId,
        performed_by_user_id: p.actorUserId,
        old_values: { status: row.status },
        new_values: { status: 'REVERSED', payment_id: p.paymentId, reason: p.reason },
      },
      m,
    );
    touched.push(id);
  }
  return touched;
}
