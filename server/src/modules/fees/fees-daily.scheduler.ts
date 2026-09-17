import { Inject, Injectable, Logger, Optional, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import * as Sentry from '@sentry/node';
import { DuplicateStrategy, FeeGenerationSource, PeriodType } from '@biddaloy/shared';
import { SchoolsService } from '../schools/schools.service';
import { FeeGenerationService } from './fee-generation.service';
import { Student } from '../students/entities/student.entity';
import { SCHOOL_TZ, todayInSchoolTz } from '../../common/time';
import { FEES_DAILY_CRON, FEES_DAILY_JOB_ID, FEES_DAILY_QUEUE } from './fees.constants';
import { LateFeeService } from './late-fee.service';

/**
 * `RecurrenceRule` per #676's documented contract (`rule jsonb` on
 * `recurring_schedules`, [16.7.1]/#675).
 */
type RecurrenceRule =
  { kind: 'MONTHLY'; day_of_month: number | 'LAST' } | { kind: 'WEEKLY'; weekdays: number[] };

/**
 * Row shape read off `recurring_schedules` (+ its `structures`/`exclusions`
 * side tables) via raw SQL rather than a TypeORM entity/repository.
 *
 * [16.7.1]/#675 — the sibling ticket that owns `RecurringSchedule` (entity,
 * migration, `recurrence.util.ts`'s real `periodFor`/`isDue`) — had not
 * merged to `main` when this was written (Wave 7 tickets run in parallel).
 * This file was built against #676's own documented contract for those
 * table/column names instead of importing code that does not exist yet.
 * Once #675 lands, this raw-SQL access and the local `periodFor`/`isDue`
 * below should be replaced with #675's real repository/entities and
 * `recurrence.util.ts` — flagged for re-verification in the PR.
 */
interface RecurringScheduleRow {
  id: string;
  tenant_id: string;
  academic_year_id: string;
  audience: { class_id?: string; section_id?: string; enrollment_status?: string };
  rule: RecurrenceRule;
  period_type: 'MONTH' | 'WEEK';
  due_days_after_period_start: number;
  starts_on: string;
  ends_on: string;
  notify_families: boolean;
  last_run_period: string | null;
  fee_structure_ids: string[];
}

/** Mirrors #675's `recurrence.util.ts` contract: first day of the billing
 * period (month/week) that contains `today`. */
export function periodFor(today: string, rule: Pick<RecurrenceRule, 'kind'>): string {
  const d = new Date(`${today}T00:00:00.000Z`);
  if (rule.kind === 'MONTHLY') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  // WEEKLY: Monday-start week containing `today`.
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
}

/** Mirrors #675's `recurrence.util.ts` contract: is `today` a firing day
 * for `rule`? */
export function isDue(rule: RecurrenceRule, today: string): boolean {
  const d = new Date(`${today}T00:00:00.000Z`);
  if (rule.kind === 'WEEKLY') {
    return rule.weekdays.includes(d.getUTCDay());
  }
  const lastDayOfMonth = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const target =
    rule.day_of_month === 'LAST' ? lastDayOfMonth : Math.min(rule.day_of_month, lastDayOfMonth);
  return d.getUTCDate() === target;
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
    // [16.7.4] #678 registers the real `LateFeeService` provider in
    // `fees.module.ts` — `@Optional()` + explicit `@Inject` (rather than
    // relying on the constructor parameter's own type, which Nest can only
    // resolve into a DI token for a concrete class) means this scheduler
    // compiles and runs correctly even before that provider exists, and
    // picks it up automatically once it does.
    @Optional()
    @Inject(LateFeeService)
    private readonly lateFeeService?: LateFeeService,
  ) {
    super();
  }

  /** Runs today's sweep for a single tenant on demand (manual trigger). */
  async runNow(tenantId: string): Promise<void> {
    await this.runTenant(tenantId, todayInSchoolTz());
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

  async process(): Promise<void> {
    const today = todayInSchoolTz();
    const tenants = await this.schoolsService.findAll();
    const activeTenants = tenants.filter((tenant) => tenant.status === 'ACTIVE');
    for (const tenant of activeTenants) {
      try {
        await this.runTenant(tenant.id, today);
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

  private async runTenant(tenantId: string, today: string): Promise<void> {
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
  }

  /** Active schedules whose window covers `today` and whose rule fires
   * today — `last_run_period` re-check happens per-schedule in
   * `runSchedule`, inside the same transaction as the write, so a
   * concurrent run can't double-fire the same period. */
  private async findDueSchedules(tenantId: string, today: string): Promise<RecurringScheduleRow[]> {
    const rows = (await this.dataSource.query(
      `SELECT rs.id, rs.tenant_id, rs.academic_year_id, rs.audience, rs.rule, rs.period_type,
              rs.due_days_after_period_start, rs.starts_on, rs.ends_on, rs.notify_families,
              rs.last_run_period,
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

    return rows.filter((row) => isDue(row.rule, today));
  }

  private async runSchedule(schedule: RecurringScheduleRow, today: string): Promise<void> {
    const period = periodFor(today, schedule.rule);
    if (schedule.last_run_period === period) return; // already ran this period

    await this.dataSource.transaction(async (manager) => {
      // Re-read + re-check under the transaction: a concurrent run for the
      // same schedule must not both pass this check and both generate.
      const [fresh] = (await manager.query(
        `SELECT last_run_period FROM recurring_schedules WHERE id = $1 FOR UPDATE`,
        [schedule.id],
      )) as { last_run_period: string | null }[];
      if (fresh?.last_run_period === period) return;

      const excludedRows = (await manager.query(
        `SELECT student_id FROM recurring_schedule_exclusions WHERE schedule_id = $1`,
        [schedule.id],
      )) as { student_id: string }[];
      const excluded = new Set(excludedRows.map((r) => r.student_id));

      const qb = manager
        .getRepository(Student)
        .createQueryBuilder('s')
        .innerJoin('s.class_section', 'cs')
        .where('s.tenant_id = :tenantId', { tenantId: schedule.tenant_id })
        .andWhere('s.deleted_at IS NULL');
      if (schedule.audience.section_id) {
        qb.andWhere('s.class_section_id = :sectionId', { sectionId: schedule.audience.section_id });
      } else if (schedule.audience.class_id) {
        qb.andWhere('cs.class_id = :classId', { classId: schedule.audience.class_id });
      }
      if (schedule.audience.enrollment_status) {
        qb.andWhere('s.enrollment_status = :status', {
          status: schedule.audience.enrollment_status,
        });
      }
      const students = await qb.getMany();
      const studentIds = students.map((s) => s.id).filter((id) => !excluded.has(id));

      if (studentIds.length === 0 || schedule.fee_structure_ids.length === 0) {
        await manager.query(`UPDATE recurring_schedules SET last_run_period = $1 WHERE id = $2`, [
          period,
          schedule.id,
        ]);
        return;
      }

      await this.feeGenerationService.generate(
        {
          academic_year_id: schedule.academic_year_id,
          period_start: period,
          period_type: schedule.period_type === 'MONTH' ? PeriodType.MONTH : PeriodType.WEEK,
          student_ids: studentIds,
          fee_structure_ids: schedule.fee_structure_ids,
          include_inactive: false,
          due_date: addDays(period, schedule.due_days_after_period_start),
          duplicate_strategy: DuplicateStrategy.SKIP,
          notify_families: schedule.notify_families,
        },
        schedule.tenant_id,
        null,
        { headers: {} },
        { source: FeeGenerationSource.SCHEDULE, recurringScheduleId: schedule.id },
      );

      // NOTE: `generate()` commits its own internal transaction, so this
      // UPDATE is not atomic with the fee rows it just wrote — if this
      // query fails after `generate()` succeeded, `last_run_period` stays
      // stale and the next sweep re-runs `generate()` for the same period.
      // That's safe, not silently duplicating bills, only because
      // `duplicate_strategy: SKIP` above makes re-generation a no-op for
      // already-generated (student_id, period) pairs. If `generate()` is
      // ever refactored to accept a caller-supplied transaction manager,
      // fold this UPDATE into that same transaction instead.
      await manager.query(`UPDATE recurring_schedules SET last_run_period = $1 WHERE id = $2`, [
        period,
        schedule.id,
      ]);
    });
  }
}
