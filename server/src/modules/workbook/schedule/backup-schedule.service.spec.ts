import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackupScheduleService } from './backup-schedule.service';
import { schedulerIdFor, BACKUP_SCHEDULE_RUN_JOB } from './backup-schedule.constants';
import { WorkbookJobKind, WorkbookJobSource } from '../jobs/workbook-job.entity';

describe('BackupScheduleService', () => {
  let queue: any;
  let schools: any;
  let exports: any;
  let service: BackupScheduleService;

  const TENANT = 'tenant-1';

  beforeEach(() => {
    queue = {
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
      removeJobScheduler: vi.fn().mockResolvedValue(undefined),
    };
    schools = {
      findById: vi.fn().mockResolvedValue({ id: TENANT, status: 'ACTIVE' }),
      findAll: vi.fn().mockResolvedValue([{ id: TENANT, status: 'ACTIVE' }]),
      getResolvedSettings: vi.fn().mockResolvedValue({
        backup: { schedule: 'WEEKLY' },
        region: { timezone: 'Asia/Dhaka' },
      }),
    };
    exports = { run: vi.fn().mockResolvedValue({ id: 'job-1' }) };
    service = new BackupScheduleService(queue, schools, exports);
  });

  describe('sync', () => {
    it('WEEKLY upserts with pattern 0 2 * * 0 and the school timezone', async () => {
      await service.sync(TENANT);

      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        schedulerIdFor(TENANT),
        { pattern: '0 2 * * 0', tz: 'Asia/Dhaka' },
        expect.objectContaining({
          name: BACKUP_SCHEDULE_RUN_JOB,
          data: { tenantId: TENANT },
        }),
      );
      expect(queue.removeJobScheduler).not.toHaveBeenCalled();
    });

    it('DAILY upserts with pattern 0 2 * * *', async () => {
      schools.getResolvedSettings.mockResolvedValue({
        backup: { schedule: 'DAILY' },
        region: { timezone: 'Asia/Dhaka' },
      });

      await service.sync(TENANT);

      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        schedulerIdFor(TENANT),
        { pattern: '0 2 * * *', tz: 'Asia/Dhaka' },
        expect.anything(),
      );
    });

    it('OFF removes the scheduler and does not upsert', async () => {
      schools.getResolvedSettings.mockResolvedValue({
        backup: { schedule: 'OFF' },
        region: { timezone: 'Asia/Dhaka' },
      });

      await service.sync(TENANT);

      expect(queue.removeJobScheduler).toHaveBeenCalledWith(schedulerIdFor(TENANT));
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    // `resolveTenantSettings` always fills `backup` from
    // `DEFAULT_BACKUP_SETTINGS` (WEEKLY) — see
    // `tenant-settings-resolver.spec.ts`'s "stored {} resolves to the
    // default WEEKLY". If `settings.backup?.schedule` is ever genuinely
    // absent anyway (a defensive case, not a real code path today), this
    // service treats that the same as OFF rather than assuming WEEKLY.
    it('backup?.schedule genuinely absent from resolved settings is treated as OFF, defensively', async () => {
      schools.getResolvedSettings.mockResolvedValue({ region: { timezone: 'Asia/Dhaka' } });

      await service.sync(TENANT);

      expect(queue.removeJobScheduler).toHaveBeenCalledWith(schedulerIdFor(TENANT));
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it('SUSPENDED school removes the scheduler and never upserts, whatever the mode', async () => {
      schools.findById.mockResolvedValue({ id: TENANT, status: 'SUSPENDED' });

      await service.sync(TENANT);

      expect(queue.removeJobScheduler).toHaveBeenCalledWith(schedulerIdFor(TENANT));
      expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
      // Status is checked before settings are even read.
      expect(schools.getResolvedSettings).not.toHaveBeenCalled();
    });

    it('falls back to Asia/Dhaka when region.timezone is missing', async () => {
      schools.getResolvedSettings.mockResolvedValue({ backup: { schedule: 'WEEKLY' } });

      await service.sync(TENANT);

      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        schedulerIdFor(TENANT),
        expect.objectContaining({ tz: 'Asia/Dhaka' }),
        expect.anything(),
      );
    });

    it('the scheduler id contains no colon (C5)', () => {
      expect(schedulerIdFor(TENANT)).not.toContain(':');
      expect(schedulerIdFor(TENANT)).toBe(`backup-schedule-${TENANT}`);
    });
  });

  describe('syncAll', () => {
    it("visits every school — removing a SUSPENDED one's scheduler — and a school whose sync throws does not stop the rest", async () => {
      schools.findAll.mockResolvedValue([
        { id: 'active-1', status: 'ACTIVE' },
        { id: 'suspended-1', status: 'SUSPENDED' },
        { id: 'active-2', status: 'ACTIVE' },
      ]);
      schools.findById.mockImplementation(async (id: string) => {
        if (id === 'active-1') throw new Error('boom');
        if (id === 'suspended-1') return { id, status: 'SUSPENDED' };
        return { id, status: 'ACTIVE' };
      });

      await service.syncAll();

      // suspended-1 is NOT skipped: `SchoolsService.updateStatus` never
      // calls sync(), so this hourly pass is the only thing that removes a
      // suspended school's scheduler before its own next tick.
      expect(queue.removeJobScheduler).toHaveBeenCalledWith(schedulerIdFor('suspended-1'));
      expect(queue.upsertJobScheduler).not.toHaveBeenCalledWith(
        schedulerIdFor('suspended-1'),
        expect.anything(),
        expect.anything(),
      );
      // active-2 still gets processed despite active-1 throwing.
      expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
        schedulerIdFor('active-2'),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('runNow', () => {
    it('calls ExportService.run with exactly { kind: EXPORT, source: SCHEDULED, requestedByUserId: null }', async () => {
      await service.runNow(TENANT);

      expect(exports.run).toHaveBeenCalledWith(TENANT, {
        kind: WorkbookJobKind.EXPORT,
        source: WorkbookJobSource.SCHEDULED,
        requestedByUserId: null,
      });
    });

    it('does not call ExportService.run for a SUSPENDED school, and cleans up the scheduler instead', async () => {
      schools.findById.mockResolvedValue({ id: TENANT, status: 'SUSPENDED' });

      await service.runNow(TENANT);

      expect(exports.run).not.toHaveBeenCalled();
      expect(queue.removeJobScheduler).toHaveBeenCalledWith(schedulerIdFor(TENANT));
    });

    it('does not call ExportService.run when the mode is now OFF, and cleans up the scheduler instead', async () => {
      schools.getResolvedSettings.mockResolvedValue({ backup: { schedule: 'OFF' } });

      await service.runNow(TENANT);

      expect(exports.run).not.toHaveBeenCalled();
      expect(queue.removeJobScheduler).toHaveBeenCalledWith(schedulerIdFor(TENANT));
    });
  });
});
