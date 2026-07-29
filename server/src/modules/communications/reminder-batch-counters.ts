import { Repository } from 'typeorm';
import { ReminderBatch } from './entities/reminder-batch.entity';

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
 */
export async function recordBatchOutcome(
  repo: Repository<ReminderBatch>,
  batchId: string,
  outcome: BatchOutcome,
): Promise<void> {
  const successInc = outcome === 'success' ? 1 : 0;
  const failureInc = outcome === 'failure' ? 1 : 0;

  await repo.query(
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
