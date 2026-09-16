import { describe, expect, it, beforeEach, vi } from 'vitest';
import { FeesDailyScheduler, periodFor, isDue } from './fees-daily.scheduler';
import { DuplicateStrategy, FeeGenerationSource, PeriodType } from '@biddaloy/shared';
import { FEES_DAILY_CRON, FEES_DAILY_JOB_ID, FEES_DAILY_QUEUE } from './fees.constants';
import { SCHOOL_TZ } from '../../common/time';

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
    queue = { upsertJobScheduler: vi.fn(async () => undefined) };
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
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FOR UPDATE')) return [{ last_run_period: null }];
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
    expect(options).toEqual({
      source: FeeGenerationSource.SCHEDULE,
      recurringScheduleId: 'sched-1',
    });
    expect(dto.duplicate_strategy).toBe(DuplicateStrategy.SKIP);
    expect(dto.period_type).toBe(PeriodType.WEEK);
    expect(dto.student_ids).toEqual(['student-1', 'student-2']);
    expect(dto.fee_structure_ids).toEqual(['fs-1']);
  });

  it('is idempotent: outer check skips before opening a transaction when last_run_period already matches this week', async () => {
    // periodFor(today, WEEKLY) is always the Monday of the current week —
    // compute it the same way `periodFor` does, so this test is
    // deterministic regardless of when the suite runs.
    const now = new Date();
    const day = now.getUTCDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setUTCDate(monday.getUTCDate() - diffToMonday);
    const thisWeekStart = monday.toISOString().slice(0, 10);
    dataSource.query = vi.fn(async () => [scheduleRow({ last_run_period: thisWeekStart })]);

    await scheduler.process();

    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(feeGenerationService.generate).not.toHaveBeenCalled();
  });

  it('re-checks last_run_period inside the transaction (FOR UPDATE) before generating', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TZ }).format(new Date());
    const currentPeriod = periodFor(today, { kind: 'WEEKLY' } as any);
    manager.query = vi.fn(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) return [{ last_run_period: currentPeriod }];
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
});
