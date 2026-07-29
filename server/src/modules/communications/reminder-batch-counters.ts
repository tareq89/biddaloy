import { EntityManager } from 'typeorm';

export type BatchOutcome = 'success' | 'failure';

/**
 * Records one recipient's terminal outcome against its batch.
 *
 * Both the increment and the final status transition happen in a single
 * statement because several queue workers finish jobs from the same batch
 * concurrently. A read-modify-write would lose counts, and computing the
 * final status in a second statement would let two workers each observe an
 * incomplete batch and leave it stuck in PROCESSING forever.
 *
 * `>= total_recipients` rather than `=` so a stray extra outcome (a job
 * replayed after a Redis restore, say) still closes the batch out.
 *
 * Takes an EntityManager, not a Repository, because the caller must run
 * this in the same transaction as the CommunicationLog's terminal save.
 * Otherwise a crash between the two — log saved SENT/FAILED, this update
 * never runs — leaves the batch permanently short a count, and a later
 * replay of that job would see the log already terminal and skip this call
 * again, so the batch would never reach total_recipients and stay in
 * PROCESSING forever. One transaction means either both commit or neither
 * does, so a retry after a crash goes through the normal (non-terminal) path
 * again instead of silently losing the count.
 */
export async function recordBatchOutcome(
  manager: EntityManager,
  batchId: string,
  outcome: BatchOutcome,
): Promise<void> {
  const successInc = outcome === 'success' ? 1 : 0;
  const failureInc = outcome === 'failure' ? 1 : 0;

  await manager.query(
    `
    UPDATE "reminder_batches"
    SET "successful_count" = "successful_count" + $2,
        "failed_count" = "failed_count" + $3,
        "status" = CASE
          WHEN "successful_count" + $2 + "failed_count" + $3 >= "total_recipients" THEN
            CASE
              WHEN "failed_count" + $3 = 0 THEN 'COMPLETED'::"public"."reminder_batches_status_enum"
              WHEN "successful_count" + $2 = 0 THEN 'FAILED'::"public"."reminder_batches_status_enum"
              ELSE 'PARTIALLY_FAILED'::"public"."reminder_batches_status_enum"
            END
          ELSE "status"
        END,
        "updated_at" = now()
    WHERE "id" = $1
    `,
    [batchId, successInc, failureInc],
  );
}
