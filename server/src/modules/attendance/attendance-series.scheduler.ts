import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as Sentry from '@sentry/node';
import { SchoolsService } from '../schools/schools.service';
import { SCHOOL_TZ } from '../../common/time';
import {
  AttendanceDashboardService,
  COMMITTEE_LIVE_DAYS,
  addDays,
} from './attendance-dashboard.service';

export const ATTENDANCE_SERIES_QUEUE = 'attendance-series';
export const ATTENDANCE_SERIES_JOB_ID = 'attendance-series';
export const ATTENDANCE_SERIES_CRON = '15 0 * * *';

/** Nightly 00:15 `SCHOOL_TZ`: precompute each tenant's 30-day series ending yesterday. */
@Injectable()
@Processor(ATTENDANCE_SERIES_QUEUE)
export class AttendanceSeriesScheduler extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AttendanceSeriesScheduler.name);

  constructor(
    @InjectQueue(ATTENDANCE_SERIES_QUEUE) private readonly queue: Queue,
    private readonly schoolsService: SchoolsService,
    private readonly dashboard: AttendanceDashboardService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      ATTENDANCE_SERIES_JOB_ID,
      { pattern: ATTENDANCE_SERIES_CRON, tz: SCHOOL_TZ },
      { opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
    this.logger.log(`Scheduled attendance series at "${ATTENDANCE_SERIES_CRON}" (${SCHOOL_TZ})`);
  }

  async process(): Promise<void> {
    for (const tenant of await this.schoolsService.findAllActive()) {
      try {
        const today = await this.schoolsService.todayFor(tenant.id);
        const yesterday = addDays(today, -1);
        await this.dashboard.storeSeries(tenant.id, yesterday);
        // Same job, second cache: the committee card's per-day tallies for the academic year,
        // up to today-8; the last 7 days are computed live on request.
        await this.dashboard.storeCommitteeDaily(
          tenant.id,
          addDays(today, -COMMITTEE_LIVE_DAYS - 1),
        );
      } catch (error) {
        this.logger.error(`attendance-series failed for tenant ${tenant.id}: ${String(error)}`);
        Sentry.withScope((scope) => {
          scope.setTag('job', 'attendance-series');
          scope.setContext('attendance_series', { tenant_id: tenant.id });
          Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
        });
      }
    }
  }
}
