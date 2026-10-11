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
