export const COMMUNICATIONS_QUEUE = 'communications';

/**
 * Every `BullModule.registerQueue({ name: COMMUNICATIONS_QUEUE })` must pass this.
 * Each registration builds its own Queue instance with its own defaults, so a
 * bare registration silently means 1 attempt and jobs kept forever (JOBS-04/05).
 * communication_logs is the durable record; Redis copies are not needed.
 */
export const COMMUNICATIONS_QUEUE_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,
  removeOnFail: 1000,
} as const;

/**
 * [68.4.10] Fee-generation and payment-receipt notices (JOBS-15). Producers enqueue after
 * their transaction commits; `FeeNotifyProcessor` runs the handlers, BullMQ retries.
 */
export const FEE_NOTIFY_QUEUE = 'fee-notify';

/**
 * Enqueue a fee-notify job after a commit. The `jobId` makes a replay a no-op only while the job
 * is waiting or running (BullMQ rejects `:` in a two-part id, so `-` joins the name and the key).
 * A finished job is removed at once (`removeOnComplete`), so a later replay adds a new job; the
 * handler's per-guardian `reference_key` check is what makes that repeat send nothing. BullMQ also
 * ignores `add` while a FAILED job keeps that id (`removeOnFail: 1000`), so a notice that used up
 * its retries is dropped first and the replay re-sends it. A Redis outage is logged, never
 * thrown: the money is already committed.
 */
export async function enqueueFeeNotify(
  queue: {
    add: (name: string, data: unknown, opts: { jobId: string }) => Promise<unknown>;
    /** Always there on a real Queue; absent in `{ add }` test doubles. */
    getJob?: (
      id: string,
    ) => Promise<{ isFailed(): Promise<boolean>; remove(): Promise<void> } | undefined>;
  },
  logger: { error: (msg: string, stack?: string) => void },
  name: 'fees.generated' | 'payments.recorded',
  key: string,
  data: unknown,
): Promise<void> {
  const jobId = `${name}-${key}`;
  try {
    const stale = await queue.getJob?.(jobId);
    if (stale && (await stale.isFailed())) await stale.remove();
    await queue.add(name, data, { jobId });
  } catch (error) {
    logger.error(
      `could not enqueue ${name} for ${key}`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}
