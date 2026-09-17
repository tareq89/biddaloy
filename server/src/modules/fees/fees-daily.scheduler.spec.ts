import { describe, expect, it, beforeEach, vi } from 'vitest';
import { FeesDailyScheduler, periodFor, isDue } from './fees-daily.scheduler';
import { DuplicateStrategy, FeeGenerationSource, PeriodType } from '@biddaloy/shared';
import { FEES_DAILY_CRON, FEES_DAILY_JOB_ID, FEES_DAILY_QUEUE } from './fees.constants';
import { SCHOOL_TZ, todayInSchoolTz } from '../../common/time';

const TENANT = 'tenant-1';

function scheduleRow(overrides: Partial<any> = {}) {
  return {
    id: 'sched-1',
    tenant_id: TENANT,
    academic_year_id: 'ay-1',
    audience: { class_id: 'class-1', enrollment_status: 'ACTIVE' },
    // WEEKLY, every weekday: makes `isDue()` true regardless of what day
    // the suite happens to run on, without faking the system clock.
    rule: { kind: 'WEEKLY', weekdays: [0, 1, 2, 3, 4, 5, 6] },
    period_type: 'WEEK',
    due_days_after_period_start: 9,
    starts_on: '2026-01-01',
    ends_on: '2026-12-31',
    notify_families: true,
    last_run_period: null,
    fee_structure_ids: ['fs-1'],
    ...overrides,
  };
}

describe('recurrence helpers', () => {
  it('periodFor: MONTHLY returns first-of-month', () => {
    expect(periodFor('2026-03-15', { kind: 'MONTHLY' } as any)).toBe('2026-03-01');
  });

  it('periodFor: WEEKLY returns Monday of that week', () => {
    // 2026-03-18 is a Wednesday.
    expect(periodFor('2026-03-18', { kind: 'WEEKLY' } as any)).toBe('2026-03-16');
  });

  it('isDue: MONTHLY fires only on the configured day_of_month', () => {
    expect(isDue({ kind: 'MONTHLY', day_of_month: 1 }, '2026-03-01')).toBe(true);
    expect(isDue({ kind: 'MONTHLY', day_of_month: 1 }, '2026-03-02')).toBe(false);
  });

  it("isDue: MONTHLY 'LAST' fires on the last calendar day of the month", () => {
    expect(isDue({ kind: 'MONTHLY', day_of_month: 'LAST' }, '2026-02-28')).toBe(true);
    expect(isDue({ kind: 'MONTHLY', day_of_month: 'LAST' }, '2026-02-27')).toBe(false);
  });

  it('isDue: WEEKLY fires on the configured weekdays', () => {
    // 2026-03-18 is a Wednesday (3).
    expect(isDue({ kind: 'WEEKLY', weekdays: [3] }, '2026-03-18')).toBe(true);
    expect(isDue({ kind: 'WEEKLY', weekdays: [1] }, '2026-03-18')).toBe(false);
  });
});

describe('FeesDailyScheduler', () => {
  let queue: any;
  let dataSource: any;
  let schoolsService: any;
  let feeGenerationService: any;
  let manager: any;
  let scheduler: FeesDailyScheduler;

  beforeEach(() => {
    queue = { upsertJobScheduler: vi.fn(async () => undefined), add: vi.fn(async () => undefined) };
    schoolsService = {
      findAll: vi.fn(async () => [{ id: TENANT, name: 'Green Valley School', status: 'ACTIVE' }]),
    };
    feeGenerationService = {
      generate: vi.fn(async () => ({
        fee_generation_id: 'fg-1',
        student_count: 1,
        generated_count: 1,
        skipped_count: 0,
        removed_count: 0,
        inactive_skipped: [],
      })),
    };
    manager = {
      // [CodeRabbit review, PR #801] runSchedule now re-reads the FULL
      // schedule row FOR UPDATE (not just last_run_period), then a
      // separate query for its fee_structure_ids — matched here so the
      // "fresh" row this mock returns exercises the same shape the real
      // query returns.
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FOR UPDATE'))
          return [{ ...scheduleRow(), is_active: true, deleted_at: null }];
        if (sql.includes('recurring_schedule_structures')) return [{ fee_structure_id: 'fs-1' }];
        if (sql.includes('recurring_schedule_exclusions')) return [];
        return [];
      }),
      getRepository: vi.fn(() => ({
        createQueryBuilder: vi.fn(() => {
          const qb: any = {
            innerJoin: vi.fn(() => qb),
            where: vi.fn(() => qb),
            andWhere: vi.fn(() => qb),
            getMany: vi.fn(async () => [{ id: 'student-1' }, { id: 'student-2' }]),
          };
          return qb;
        }),
      })),
    };
    dataSource = {
      query: vi.fn(async () => [scheduleRow()]),
      transaction: vi.fn(async (cb: any) => cb(manager)),
    };

    scheduler = new FeesDailyScheduler(queue, dataSource, schoolsService, feeGenerationService);
  });

  it('registers the repeatable job on boot at 00:30 SCHOOL_TZ', async () => {
    await scheduler.onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      FEES_DAILY_JOB_ID,
      { pattern: FEES_DAILY_CRON, tz: SCHOOL_TZ },
      expect.any(Object),
    );
  });

  it('calls FeeGenerationService.generate with source SCHEDULE for a due schedule', async () => {
    await scheduler.process();

    expect(feeGenerationService.generate).toHaveBeenCalledTimes(1);
    const [dto, tenantId, userId, , options] = feeGenerationService.generate.mock.calls[0];
    expect(tenantId).toBe(TENANT);
    expect(userId).toBeNull();
    expect(options).toMatchObject({
      source: FeeGenerationSource.SCHEDULE,
      recurringScheduleId: 'sched-1',
    });
    // [CodeRabbit review, PR #801] the transaction's own manager is
    // passed through so generate()'s writes and the schedule's
    // last_run_period update share one transaction.
    expect(options.manager).toBe(manager);
    expect(dto.duplicate_strategy).toBe(DuplicateStrategy.SKIP);
    expect(dto.period_type).toBe(PeriodType.WEEK);
    expect(dto.student_ids).toEqual(['student-1', 'student-2']);
    expect(dto.fee_structure_ids).toEqual(['fs-1']);
  });

  it('is idempotent: outer check skips before opening a transaction when last_run_period already matches this week', async () => {
    // periodFor(today, WEEKLY) is always the Monday of the current week —
    // computed via the same todayInSchoolTz()/periodFor() the scheduler
    // itself uses (not a raw `new Date()`/UTC calculation), so this test
    // agrees with process() even in the window between Sunday 18:00 UTC
    // and Monday 00:00 UTC, where the Asia/Dhaka calendar date is already
    // Monday but the UTC calendar date is still Sunday.
    const thisWeekStart = periodFor(todayInSchoolTz(), { kind: 'WEEKLY' });
    dataSource.query = vi.fn(async () => [scheduleRow({ last_run_period: thisWeekStart })]);

    await scheduler.process();

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(feeGenerationService.generate).not.toHaveBeenCalled();
  });

  it('re-checks last_run_period inside the transaction (FOR UPDATE) before generating', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TZ }).format(new Date());
    const currentPeriod = periodFor(today, { kind: 'WEEKLY' } as any);
    manager.query = vi.fn(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) {
        return [
          { ...scheduleRow(), last_run_period: currentPeriod, is_active: true, deleted_at: null },
        ];
      }
      return [];
    });

    await scheduler.process();

    expect(feeGenerationService.generate).not.toHaveBeenCalled();
  });

  it('does not let one tenant throwing block the rest of the sweep', async () => {
    schoolsService.findAll = vi.fn(async () => [
      { id: 'tenant-broken', name: 'Broken', status: 'ACTIVE' },
      { id: TENANT, name: 'Green Valley School', status: 'ACTIVE' },
    ]);
    let call = 0;
    dataSource.query = vi.fn(async (_sql: string, params: any[]) => {
      call += 1;
      if (params?.[0] === 'tenant-broken') throw new Error('boom');
      return [scheduleRow()];
    });

    await expect(scheduler.process()).resolves.not.toThrow();
    expect(feeGenerationService.generate).toHaveBeenCalledTimes(1);
  });

  it('does not let one failing schedule block the rest of the tenant', async () => {
    dataSource.query = vi.fn(async () => [
      scheduleRow({ id: 'sched-1' }),
      scheduleRow({ id: 'sched-2' }),
    ]);
    let call = 0;
    feeGenerationService.generate = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error('generation failed');
      return {
        fee_generation_id: 'fg-2',
        student_count: 1,
        generated_count: 1,
        skipped_count: 0,
        removed_count: 0,
        inactive_skipped: [],
      };
    });

    await expect(scheduler.process()).resolves.not.toThrow();
    expect(feeGenerationService.generate).toHaveBeenCalledTimes(2);
  });

  it('marks a schedule as run without calling generate() when the audience resolves empty', async () => {
    manager.getRepository = vi.fn(() => ({
      createQueryBuilder: vi.fn(() => {
        const qb: any = {
          innerJoin: vi.fn(() => qb),
          where: vi.fn(() => qb),
          andWhere: vi.fn(() => qb),
          getMany: vi.fn(async () => []),
        };
        return qb;
      }),
    }));

    await scheduler.process();

    expect(feeGenerationService.generate).not.toHaveBeenCalled();
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE recurring_schedules SET last_run_period'),
      expect.any(Array),
    );
  });

  describe('[CodeRabbit review, PR #801] run-now enqueues instead of running inline', () => {
    it('runNow only enqueues a tenant-scoped job — it does not run the sweep itself', async () => {
      await scheduler.runNow(TENANT);

      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith('run-now', { tenantId: TENANT });
      // The point of enqueueing: runNow itself never touches the DB/queries
      // a due schedule — that only happens once a worker picks the job up
      // and calls process().
      expect(dataSource.query).not.toHaveBeenCalled();
      expect(feeGenerationService.generate).not.toHaveBeenCalled();
    });

    it('process(job) with job.data.tenantId sweeps only that tenant, not every active tenant', async () => {
      schoolsService.findAll = vi.fn(async () => [
        { id: TENANT, name: 'Green Valley School', status: 'ACTIVE' },
        { id: 'tenant-other', name: 'Other School', status: 'ACTIVE' },
      ]);

      await scheduler.process({ data: { tenantId: TENANT } } as any);

      // findAll (the full-sweep tenant list) is never even consulted on
      // the tenant-scoped path.
      expect(schoolsService.findAll).not.toHaveBeenCalled();
      expect(feeGenerationService.generate).toHaveBeenCalledTimes(1);
      const [, tenantId] = feeGenerationService.generate.mock.calls[0];
      expect(tenantId).toBe(TENANT);
    });

    it('process() with no job (the nightly repeatable job) still sweeps every active tenant', async () => {
      await scheduler.process();

      expect(schoolsService.findAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('[CodeRabbit review, PR #801] resilience fixes', () => {
    it('a malformed recurrence rule (isDue throws) is skipped, not left to crash findDueSchedules for the whole tenant', async () => {
      // A second, well-formed schedule must still run even though the
      // first row's rule is malformed (WEEKLY with no weekdays array).
      dataSource.query = vi.fn(async () => [
        scheduleRow({ id: 'sched-malformed', rule: { kind: 'WEEKLY' } as any }),
        scheduleRow({ id: 'sched-ok' }),
      ]);

      // Only the well-formed row ('sched-ok') should ever reach
      // runSchedule/generate() — the malformed one is filtered out inside
      // findDueSchedules itself, before either schedule's transaction
      // opens.
      await expect(scheduler.process()).resolves.not.toThrow();
      expect(feeGenerationService.generate).toHaveBeenCalledTimes(1);
    });

    it('re-reads the full schedule row under the lock — a schedule deactivated between the outer read and the lock is not run', async () => {
      manager.query = vi.fn(async (sql: string) => {
        // The FOR UPDATE re-read returns is_active: false — simulating an
        // admin disabling the schedule in the gap between findDueSchedules'
        // outer snapshot and this transaction acquiring the row lock.
        if (sql.includes('FOR UPDATE'))
          return [{ ...scheduleRow(), is_active: false, deleted_at: null }];
        return [];
      });

      await scheduler.process();

      expect(feeGenerationService.generate).not.toHaveBeenCalled();
    });
  });
});
