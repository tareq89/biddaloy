import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackupScheduleProcessor } from './backup-schedule.processor';
import {
  BACKUP_SCHEDULE_RECONCILE_ID,
  BACKUP_SCHEDULE_RECONCILE_INTERVAL_MS,
  BACKUP_SCHEDULE_RECONCILE_JOB,
  BACKUP_SCHEDULE_RUN_JOB,
} from './backup-schedule.constants';

vi.mock('@sentry/node', () => ({
  withScope: (fn: (scope: any) => void) => fn({ setTags: vi.fn() }),
  captureException: vi.fn(),
}));

describe('BackupScheduleProcessor', () => {
  let queue: any;
  let service: any;
  let processor: BackupScheduleProcessor;

  beforeEach(() => {
    queue = { upsertJobScheduler: vi.fn().mockResolvedValue(undefined) };
    service = {
      syncAll: vi.fn().mockResolvedValue(undefined),
      runNow: vi.fn().mockResolvedValue(undefined),
    };
    processor = new BackupScheduleProcessor(queue, service);
  });

  describe('process', () => {
    it('dispatches BACKUP_SCHEDULE_RUN_JOB to runNow with the tenant id', async () => {
      await processor.process({
        name: BACKUP_SCHEDULE_RUN_JOB,
        data: { tenantId: 'tenant-1' },
      } as any);

      expect(service.runNow).toHaveBeenCalledWith('tenant-1');
      expect(service.syncAll).not.toHaveBeenCalled();
    });

    it('dispatches BACKUP_SCHEDULE_RECONCILE_JOB to syncAll', async () => {
      await processor.process({ name: BACKUP_SCHEDULE_RECONCILE_JOB, data: {} } as any);

      expect(service.syncAll).toHaveBeenCalledTimes(1);
      expect(service.runNow).not.toHaveBeenCalled();
    });

    it('warns and calls neither for an unknown job name', async () => {
      const logger = { warn: vi.fn(), error: vi.fn() };
      (processor as any).logger = logger;

      await processor.process({ name: 'something-else', data: {} } as any);

      expect(logger.warn).toHaveBeenCalled();
      expect(service.runNow).not.toHaveBeenCalled();
      expect(service.syncAll).not.toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('registers the reconciler with every: 3600000 and then calls syncAll', async () => {
      await processor.onModuleInit();

      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        BACKUP_SCHEDULE_RECONCILE_ID,
        { every: BACKUP_SCHEDULE_RECONCILE_INTERVAL_MS },
        expect.objectContaining({ name: BACKUP_SCHEDULE_RECONCILE_JOB }),
      );
      expect(BACKUP_SCHEDULE_RECONCILE_INTERVAL_MS).toBe(3600000);
      expect(service.syncAll).toHaveBeenCalledTimes(1);
    });

    it('does not throw when syncAll rejects', async () => {
      service.syncAll.mockRejectedValue(new Error('db down'));

      await expect(processor.onModuleInit()).resolves.toBeUndefined();
    });
  });
});
