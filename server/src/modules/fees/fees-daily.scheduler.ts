import { Inject, Injectable, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import * as Sentry from '@sentry/node';
import { DuplicateStrategy, FeeGenerationSource, PeriodType } from '@biddaloy/shared';
import { emitRecheck } from '../attention/engine/attention-events';
import { attentionEvents } from '../attention/attention.constants';
import { enqueueFeeNotify, FEE_NOTIFY_QUEUE } from '../communications/communications.constants';
import { SchoolsService } from '../schools/schools.service';
import { TenantStatusService } from '../schools/tenant-status.service';
import { FeeGenerationService, FeesGeneratedEventPayload } from './fee-generation.service';
import { Student } from '../students/entities/student.entity';
import { SCHOOL_TZ } from '../../common/time';
import {
  FEES_DAILY_CRON,
  FEES_DAILY_JOB_ID,
  FEES_DAILY_QUEUE,
  FEES_DAILY_RESTORE_RETRY_MS,
} from './fees.constants';
import { LateFeeService } from './late-fee.service';
import { FineSweepService } from './fines/fine-sweep.service';
import { applyProgramAudience } from './program-audience';
import { firstFireInPeriod, periodFor } from './recurrence.util';
import type { RecurringScheduleRule } from './entities/recurring-schedule.entity';

/**
 * Row shape read off `recurring_schedules` (+ its `structures`/`exclusions`
 * side tables) via raw SQL rather than a TypeORM entity/repository. The
 * period maths and the "due" test come from `recurrence.util.ts`.
 */
interface RecurringScheduleRow {
  id: string;
  tenant_id: string;
  academic_year_id: string;
  audience: {
    class_id?: string;
    section_id?: string;
    program_id?: string;
    enrollment_status?: string;
  };
  rule: RecurringScheduleRule;
  period_type: 'MONTH' | 'WEEK';
  due_days_after_period_start: number;
  starts_on: string;
  ends_on: string;
  notify_families: boolean;
  last_run_period: string | null;
  fee_structure_ids: string[];
}

/** Normal due date, unless it is today or past: then the bill is due tomorrow, so the
 * late-fee sweep that runs right after (it counts due_date + grace <= today) skips it
 * even with 0 grace days. */
function catchUpDueDate(normal: string, today: string): string {
  return normal > today ? normal : addDays(today, 1);
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Registers the daily `fees-daily` repeatable job (00:30 `SCHOOL_TZ`) and
 * runs it: one sweep of every tenant, one transaction per due
 * `RecurringSchedule`, calling `FeeGenerationService.generate` with
 * `source: SCHEDULE` for each. Cloned from `AbsenceNoticeScheduler`'s
 * shape ([9.8]) — a single class is both the `@Processor` and the
 * `OnModuleInit` registrar, since there is no per-job payload worth a
 * separate processor file.
 *
 * Isolation, [16.7.2]: a schedule that throws (bad rule data, a student
 * query failure, `generate()` rejecting) is logged to Sentry with
 * `{ tenant_id, schedule_id }` and skipped — it never blocks the rest of
 * that tenant's schedules or the rest of the tenants in the sweep.
 */
@Injectable()
@Processor(FEES_DAILY_QUEUE)
export class FeesDailyScheduler extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(FeesDailyScheduler.name);

  constructor(
    @InjectQueue(FEES_DAILY_QUEUE) private readonly queue: Queue,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly schoolsService: SchoolsService,
    private readonly feeGenerationService: FeeGenerationService,
    // [68.1.2210] Required, not `@Optional()` (its module is `@Global()`): a missing provider must
    // fail at boot, not silently turn the restore skip off. Sits before the optional seams below
    // because TypeScript forbids a required parameter after an optional one.
    private readonly tenantStatus: TenantStatusService,
    @InjectQueue(FEE_NOTIFY_QUEUE) private readonly feeNotifyQueue: Queue,
    // [16.7.4] #678 registers the real `LateFeeService` provider in
    // `fees.module.ts` — `@Optional()` + explicit `@Inject` (rather than
    // relying on the constructor parameter's own type, which Nest can only
    // resolve into a DI token for a concrete class) means this scheduler
    // compiles and runs correctly even before that provider exists, and
    // picks it up automatically once it does.
    @Optional()
    @Inject(LateFeeService)
    private readonly lateFeeService?: LateFeeService,
    // [38.2.5] Same `@Optional()` + explicit `@Inject` seam as
    // `lateFeeService` above, left by [38.1]/#1112 for this ticket to fill
    // in `fees.module.ts`.
    @Optional()
    @Inject(FineSweepService)
    private readonly fineSweepService?: FineSweepService,
  ) {
    super();
  }

  /**
   * [CodeRabbit review, PR #801] `POST /fees/schedules/run-now` is
   * documented (and returns `202`) as an enqueue operation, not a
   * synchronous one — the original implementation instead awaited the
   * whole tenant sweep inline before responding, so the request stayed
   * open for the full workload (every due schedule's `generate()` call
   * plus the late-fee sweep) with no bound on how long that takes for a
   * large tenant. This now only enqueues a tenant-scoped job and returns;
   * `process()` below does the actual work asynchronously, the same as
   * every other job on this queue.
   */
  async runNow(tenantId: string): Promise<void> {
    await this.queue.add('run-now', { tenantId });
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      FEES_DAILY_JOB_ID,
      { pattern: FEES_DAILY_CRON, tz: SCHOOL_TZ },
      {
        opts: {
          removeOnComplete: true,
          removeOnFail: 100,
        },
      },
    );
    this.logger.log(`Scheduled fees-daily run at "${FEES_DAILY_CRON}" (${SCHOOL_TZ})`);
  }

  /**
   * Two job shapes on this one queue: the nightly repeatable job
   * (`onModuleInit`, no `job.data`) sweeps every active tenant; a manual
   * `run-now` job (`runNow` above, `job.data.tenantId` set) sweeps only
   * the caller's own tenant — same per-tenant `runTenant` either way.
   * A `restore-catch-up` job also carries `today`: the day the school was
   * skipped on, so that day's schedules still fire (see `runTenant`).
   */
  async process(job?: Job<{ tenantId?: string; today?: string } | undefined>): Promise<void> {
    // Catch-up replays a fixed day; every other path derives each school's own today.
    const todayOverride = job?.data?.today;
    const requestedTenantId = job?.data?.tenantId;

    if (requestedTenantId) {
      // `run-now` passed ContextGuard's status check; a catch-up has no user, so re-check here.
      if (
        job?.name === 'restore-catch-up' &&
        (await this.schoolsService.findById(requestedTenantId)).status !== 'ACTIVE'
      )
        return;
      await this.runTenant(requestedTenantId, todayOverride);
      return;
    }

    const tenants = await this.schoolsService.findAll();
    const activeTenants = tenants.filter((tenant) => tenant.status === 'ACTIVE');
    for (const tenant of activeTenants) {
      try {
        await this.runTenant(tenant.id, todayOverride);
      } catch (error) {
        this.logger.error(`fees-daily sweep failed for tenant ${tenant.id}: ${String(error)}`);
        Sentry.withScope((scope) => {
          scope.setTag('job', 'fees-daily');
          scope.setContext('fees_daily', { tenant_id: tenant.id });
          Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
        });
      }
    }
  }

  private async runTenant(tenantId: string, todayOverride?: string): Promise<void> {
    const today = todayOverride ?? (await this.schoolsService.todayFor(tenantId));
    // A restore is rewriting this school's data, so skip it for now. The next
    // nightly run picks the period up only while still inside it (due on or
    // after the fire day), so a restore spanning the period's last day would
    // lose it. Re-queue the school for this same `today` and keep
    // retrying until the lock clears (a live restore renews it; a crashed one
    // expires after the 1 h TTL). One job per 15 min per restoring school.
    // `last_run_period` keeps the catch-up exactly-once; the late-fee and fine
    // sweeps below are idempotent for a past `today` too.
    if (await this.tenantStatus.isRestoring(tenantId, { failClosed: true })) {
      await this.queue.add(
        'restore-catch-up',
        { tenantId, today },
        { delay: FEES_DAILY_RESTORE_RETRY_MS, removeOnComplete: true, removeOnFail: 100 },
      );
      this.logger.log(`fees-daily: tenant ${tenantId} restoring, catch-up for ${today} re-queued`);
      return;
    }
    const schedules = await this.findDueSchedules(tenantId, today);
    for (const schedule of schedules) {
      try {
        await this.runSchedule(schedule, today);
      } catch (error) {
        this.logger.error(
          `fees-daily schedule ${schedule.id} failed for tenant ${tenantId}: ${String(error)}`,
        );
        Sentry.withScope((scope) => {
          scope.setTag('job', 'fees-daily');
          scope.setContext('fees_daily', { tenant_id: tenantId, schedule_id: schedule.id });
          Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
        });
      }
    }

    // [16.7.4] Late fees run once per tenant, after all due schedules for
    // that tenant have generated their bills — `lateFeeService` is
    // undefined until #678 registers it in `fees.module.ts`.
    if (this.lateFeeService) {
      try {
        await this.lateFeeService.applyDue(tenantId, today);
      } catch (error) {
        this.logger.error(
          `fees-daily late-fee sweep failed for tenant ${tenantId}: ${String(error)}`,
        );
        Sentry.withScope((scope) => {
          scope.setTag('job', 'fees-daily-late-fees');
          scope.setContext('fees_daily', { tenant_id: tenantId });
          Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
        });
      }
    }

    // [38.2.5] Attendance-fine sweep runs last, once per tenant — its own
    // try/catch so a throw here never stops the rest of the tenants in the
    // outer `process()` loop. `runDue` itself already no-ops silently when
    // no academic year covers the target month, so this only ever logs a
    // genuine failure.
    if (this.fineSweepService) {
      try {
        await this.fineSweepService.runDue(tenantId, today);
      } catch (error) {
        this.logger.error(`fees-daily fine sweep failed for tenant ${tenantId}: ${String(error)}`);
        Sentry.withScope((scope) => {
          scope.setTag('job', 'fees-daily-fine-sweep');
          scope.setContext('fees_daily', { tenant_id: tenantId });
          Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
        });
      }
    }
  }

  /** Active schedules whose window covers `today` and whose rule's fire day this
   * period has arrived (due on or after the fire day, once per period) — `last_run_period` re-check happens per-schedule in
   * `runSchedule`, inside the same transaction as the write, so a
   * concurrent run can't double-fire the same period. */
  private async findDueSchedules(tenantId: string, today: string): Promise<RecurringScheduleRow[]> {
    const rows = (await this.dataSource.query(
      `SELECT rs.id, rs.tenant_id, rs.academic_year_id, rs.audience, rs.rule, rs.period_type,
              rs.due_days_after_period_start, rs.starts_on::text AS starts_on, rs.ends_on::text AS ends_on,
              rs.notify_families, rs.last_run_period::text AS last_run_period,
              COALESCE(array_agg(rss.fee_structure_id) FILTER (WHERE rss.fee_structure_id IS NOT NULL), '{}') AS fee_structure_ids
         FROM recurring_schedules rs
         LEFT JOIN recurring_schedule_structures rss ON rss.schedule_id = rs.id
        WHERE rs.tenant_id = $1
          AND rs.is_active = true
          AND rs.deleted_at IS NULL
          AND rs.starts_on <= $2
          AND rs.ends_on >= $2
        GROUP BY rs.id`,
      [tenantId, today],
    )) as RecurringScheduleRow[];

    // [CodeRabbit review, PR #801] firstFireInPeriod() throws on a malformed rule
    // (e.g. a persisted WEEKLY row with no weekdays) — this runs before
    // runTenant's per-schedule try/catch, so one bad row here would
    // otherwise abort findDueSchedules entirely and skip every other
    // schedule (and the tenant's late-fee sweep) for this tenant, not
    // just the malformed one.
    return rows.filter((row) => {
      try {
        return firstFireInPeriod(row.rule, today, row.starts_on) !== null;
      } catch (error) {
        this.logger.error(
          `fees-daily: schedule ${row.id} has a malformed recurrence rule, skipping: ${String(error)}`,
        );
        Sentry.withScope((scope) => {
          scope.setTag('job', 'fees-daily');
          scope.setContext('fees_daily', { tenant_id: tenantId, schedule_id: row.id });
          Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
        });
        return false;
      }
    });
  }

  private async runSchedule(schedule: RecurringScheduleRow, today: string): Promise<void> {
    const period = periodFor(today, schedule.rule);
    if (schedule.last_run_period === period) return; // already ran this period

    // [CodeRabbit review, PR #801] Set only if `generate()` actually ran
    // inside this transaction — emitted *after* the transaction below
    // commits, not from inside it (same "only after commit" rule
    // `FeeGenerationService.generate` itself normally follows for its own
    // non-scheduler callers).
    let notifyPayload: FeesGeneratedEventPayload | null = null;
    let generatedTenantId: string | null = null;

    await this.dataSource.transaction(async (manager) => {
      // [CodeRabbit review, PR #801] Re-read the FULL schedule row under
      // the lock, not just last_run_period — the outer `schedule` snapshot
      // was read before this transaction opened, so if an admin disabled,
      // rescheduled, or re-targeted the audience of this schedule in that
      // gap, the old code would still generate against the stale
      // audience/rule/date-window it read minutes (or longer) earlier.
      const [fresh] = (await manager.query(
        `SELECT id, tenant_id, academic_year_id, audience, rule, period_type,
                due_days_after_period_start, starts_on::text AS starts_on, ends_on::text AS ends_on,
                notify_families, last_run_period::text AS last_run_period, is_active, deleted_at
           FROM recurring_schedules
          WHERE id = $1
          FOR UPDATE`,
        [schedule.id],
      )) as (Omit<RecurringScheduleRow, 'fee_structure_ids'> & {
        is_active: boolean;
        deleted_at: string | null;
      })[];

      if (!fresh || !fresh.is_active || fresh.deleted_at) return;
      if (fresh.starts_on > today || fresh.ends_on < today) return;
      if (firstFireInPeriod(fresh.rule, today, fresh.starts_on) === null) return;

      const freshPeriod = periodFor(today, fresh.rule);
      if (fresh.last_run_period === freshPeriod) return;

      // A stale restore catch-up (past `today`) can reach a period already billed after
      // `last_run_period` moved on; the batch row is the per-period key.
      const [billed] = await manager.query(
        `SELECT 1 FROM fee_generations WHERE tenant_id = $1 AND recurring_schedule_id = $2 AND period_start = $3 LIMIT 1`,
        [fresh.tenant_id, fresh.id, freshPeriod],
      );
      if (billed) return;

      const feeStructureRows = (await manager.query(
        `SELECT fee_structure_id FROM recurring_schedule_structures WHERE schedule_id = $1`,
        [fresh.id],
      )) as { fee_structure_id: string }[];
      const feeStructureIds = feeStructureRows.map((r) => r.fee_structure_id);

      const excludedRows = (await manager.query(
        `SELECT student_id FROM recurring_schedule_exclusions WHERE schedule_id = $1`,
        [fresh.id],
      )) as { student_id: string }[];
      const excluded = new Set(excludedRows.map((r) => r.student_id));

      const qb = manager
        .getRepository(Student)
        .createQueryBuilder('s')
        .innerJoin('s.class_section', 'cs')
        .where('s.tenant_id = :tenantId', { tenantId: fresh.tenant_id })
        .andWhere('s.deleted_at IS NULL');
      if (fresh.audience.section_id) {
        qb.andWhere('s.class_section_id = :sectionId', { sectionId: fresh.audience.section_id });
      } else if (fresh.audience.class_id) {
        qb.andWhere('cs.class_id = :classId', { classId: fresh.audience.class_id });
      }
      if (fresh.audience.program_id) {
        applyProgramAudience(qb, fresh.audience.program_id, fresh.tenant_id);
      }
      if (fresh.audience.enrollment_status) {
        qb.andWhere('s.enrollment_status = :status', {
          status: fresh.audience.enrollment_status,
        });
      }
      const students = await qb.getMany();
      const studentIds = students.map((s) => s.id).filter((id) => !excluded.has(id));

      // ponytail: this path writes no fee_generations row, so the stale-catch-up check above
      // cannot see it; GREATEST still stops the rewind. Rare; record a marker row if it bites.
      if (studentIds.length === 0 || feeStructureIds.length === 0) {
        await manager.query(
          `UPDATE recurring_schedules SET last_run_period = GREATEST(last_run_period, $1::date) WHERE id = $2`,
          [freshPeriod, fresh.id],
        );
        return;
      }

      const result = await this.feeGenerationService.generate(
        {
          academic_year_id: fresh.academic_year_id,
          period_start: freshPeriod,
          period_type: fresh.period_type === 'MONTH' ? PeriodType.MONTH : PeriodType.WEEK,
          student_ids: studentIds,
          fee_structure_ids: feeStructureIds,
          include_inactive: false,
          // A caught-up run must not create a bill that is already overdue (the late-fee sweep
          // runs right after): never due before tomorrow.
          due_date: catchUpDueDate(addDays(freshPeriod, fresh.due_days_after_period_start), today),
          duplicate_strategy: DuplicateStrategy.SKIP,
          notify_families: fresh.notify_families,
        },
        fresh.tenant_id,
        null,
        { headers: {} },
        {
          source: FeeGenerationSource.SCHEDULE,
          recurringScheduleId: fresh.id,
          // [CodeRabbit review, PR #801] Reuse this transaction's own
          // manager rather than letting `generate()` open an independent
          // one — the bills it writes and the `last_run_period` update
          // below now commit or roll back together. `generate()` skips
          // its own notify-event emit when a manager is supplied (see its
          // doc comment); this scheduler emits it itself, below, only
          // after this whole transaction has actually committed.
          manager,
        },
      );

      // Same transaction as the bills `generate()` just wrote — a failure
      // here now rolls back the generation too, instead of leaving it
      // committed with the schedule still "due" for the next sweep to
      // re-trigger (a second `FeeGeneration` batch row / notify event,
      // even though `duplicate_strategy: SKIP` already made the *bills*
      // themselves idempotent).
      await manager.query(
        `UPDATE recurring_schedules SET last_run_period = GREATEST(last_run_period, $1::date) WHERE id = $2`,
        [freshPeriod, fresh.id],
      );

      generatedTenantId = fresh.tenant_id;
      if (fresh.notify_families) {
        notifyPayload = { tenantId: fresh.tenant_id, feeGenerationId: result.fee_generation_id };
      }
    });

    // Fires only after the transaction above has actually committed.
    const notify = notifyPayload as FeesGeneratedEventPayload | null;
    if (notify) {
      await enqueueFeeNotify(
        this.feeNotifyQueue,
        this.logger,
        'fees.generated',
        notify.feeGenerationId,
        notify,
      );
    }
    if (generatedTenantId) {
      for (const ruleKey of [
        'fees.unassigned_students',
        'fees.due_soon',
        'fees.overdue_family',
      ] as const) {
        emitRecheck(attentionEvents, { tenantId: generatedTenantId as string, ruleKey });
      }
    }
  }
}
