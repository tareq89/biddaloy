import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Queue, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { OPS_QUEUES } from './ops-queues';
import { OpsQueuesService } from './ops-queues.service';

const OWNER = '11111111-1111-4111-8111-111111111111';
const NAME = OPS_QUEUES[0];

/** Real BullMQ queue on the worker's Redis; only the audit and module lookup are stubbed. */
describe('OpsQueuesService (real queue)', () => {
  let queue: Queue;
  let svc: OpsQueuesService;
  const audited: unknown[] = [];

  beforeAll(() => {
    const url = new URL(process.env.REDIS_URL!);
    const connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      db: Number(url.pathname.slice(1) || 0),
      maxRetriesPerRequest: null,
    };
    // A unique prefix keeps this spec off every real queue key.
    queue = new Queue(NAME, { connection, prefix: `ops-it-${randomUUID()}` });
    svc = new OpsQueuesService(
      { get: () => queue } as never,
      { recordApproved: async (e: unknown) => void audited.push(e) } as never,
    );
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('a failed job is retried, the failed count drops and the retry is audited', async () => {
    await queue.add('x', { secret: 'school data' }, { attempts: 1 });
    const failed = new Promise<void>((resolve) => {
      const w = new Worker(
        NAME,
        async () => {
          throw new Error('fail');
        },
        { connection: queue.opts.connection as never, prefix: queue.opts.prefix },
      );
      w.on('failed', async () => {
        await w.close();
        resolve();
      });
    });
    await failed;
    const before = (await svc.list()).find((q) => q.name === NAME)!;
    expect(before.failed).toBe(1);

    await expect(svc.retryFailed(NAME, OWNER)).resolves.toEqual({ retried: 1 });

    const after = (await svc.list()).find((q) => q.name === NAME)!;
    expect(after.failed).toBe(0);
    expect(after.waiting).toBe(1); // moved back to waiting for a worker to pick up
    expect(audited).toHaveLength(1);
    expect(JSON.stringify(before)).not.toContain('school data'); // counts only
  });
});
