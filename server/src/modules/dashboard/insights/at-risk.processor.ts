import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import * as Sentry from '@sentry/node';
import { SchoolsService } from '../../schools/schools.service';
import { SCHOOL_TZ } from '../../../common/time';
import { AtRiskService } from './at-risk.service';
import {
  AT_RISK_CRON,
  AT_RISK_QUEUE,
  AT_RISK_SWEEP_JOB,
  AT_RISK_TENANT_JOB,
} from './at-risk.constants';

/**
 * Nightly at-risk precompute: `sweep` (00:30 `SCHOOL_TZ`, every active tenant, one tenant's
 * failure never stops the rest) and `tenant` (one tenant, enqueued by the read path).
 */
@Injectable()
@Processor(AT_RISK_QUEUE)
export class AtRiskProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AtRiskProcessor.name);

  constructor(
    @InjectQueue(AT_RISK_QUEUE) private readonly queue: Queue,
    private readonly schools: SchoolsService,
    private readonly atRisk: AtRiskService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      AT_RISK_SWEEP_JOB,
      { pattern: AT_RISK_CRON, tz: SCHOOL_TZ },
      { name: AT_RISK_SWEEP_JOB, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async process(job: Job<{ tenantId?: string } | undefined>): Promise<void> {
    if (job.name === AT_RISK_TENANT_JOB && job.data?.tenantId) {
      await this.atRisk.refresh(job.data.tenantId);
      return;
    }
    for (const tenant of await this.schools.findAllActive()) {
      try {
        await this.atRisk.refresh(tenant.id);
      } catch (error) {
        this.logger.error(`at-risk sweep failed for tenant ${tenant.id}: ${String(error)}`);
        Sentry.withScope((scope) => {
          scope.setTag('job', 'dashboard-at-risk');
          scope.setContext('at_risk', { tenant_id: tenant.id });
          Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
        });
      }
    }
  }
}
