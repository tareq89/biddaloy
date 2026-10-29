import { Repository } from 'typeorm';
import { CommunicationLog } from '../entities/communication-log.entity';

/**
 * Atomic ownership of a QUEUED log, carried in `metadata.claimed_by` (the BullMQ job id)
 * so no enum migration is needed. Both sides are one conditional UPDATE, so exactly one wins:
 *  - the worker claims before delivering (a retry of the SAME job re-claims its own claim);
 *  - the enqueue-timeout path fails the log only while it is still QUEUED and unclaimed.
 * Used only by ARRIVAL_NOTICE, the one producer that races a bounded `queue.add`.
 */

/** True when this job now owns the log (first claim, or a retry of its own claim). */
export async function claimQueuedLog(
  repo: Repository<CommunicationLog>,
  logId: string,
  jobId: string,
): Promise<boolean> {
  // TypeORM's pg driver returns [rows, rowCount] for UPDATE ... RETURNING.
  const [rows] = (await repo.query(
    `UPDATE communication_logs
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('claimed_by', $2::text)
      WHERE id = $1 AND status = 'QUEUED'
        AND (metadata->>'claimed_by' IS NULL OR metadata->>'claimed_by' = $2::text)
      RETURNING id`,
    [logId, jobId],
  )) as [unknown[], number];
  return rows.length > 0;
}

/** Enqueue-timeout path: FAILED + frees reference_key, only if still QUEUED and unclaimed. */
export async function failUnclaimedLog(
  repo: Repository<CommunicationLog>,
  logId: string,
  error: string,
): Promise<boolean> {
  const [rows] = (await repo.query(
    `UPDATE communication_logs
        SET status = 'FAILED', reference_key = NULL,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('error', $2::text)
      WHERE id = $1 AND status = 'QUEUED' AND metadata->>'claimed_by' IS NULL
      RETURNING id`,
    [logId, error],
  )) as [unknown[], number];
  return rows.length > 0;
}
