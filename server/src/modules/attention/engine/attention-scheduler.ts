import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { DataSource, Repository } from 'typeorm';
import { AlertCadence } from '@biddaloy/shared';
import type { AlertRuleMeta, AttentionSettings } from '@biddaloy/shared';
import { School } from '../../schools/entities/school.entity';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';
import {
  ATTENTION_JITTER_MS,
  ATTENTION_QUEUE,
  ATTENTION_RETENTION_MONTHS,
  ATTENTION_RULE_BUDGET_MS,
  ATTENTION_SWEEP_DONE,
  ATTENTION_TENANT_CONCURRENCY,
  DAILY_MARKER_TTL_SECONDS,
  DAILY_TICK_MS,
  EVENING_RULE_KEYS,
  FAST_INTERVAL_MS,
  HOURLY_INTERVAL_MS,
  JOB_DAILY,
  JOB_FAST,
  JOB_HOURLY,
  JOB_RECHECK,
  attentionEvents,
  attentionKeys,
} from '../attention.constants';
import { RuleContextService } from '../rules/rule-context.service';
import { RuleRegistryService } from '../rules/rule-registry.service';
import type { AttentionRule, RuleContext } from '../rules/rule.types';
import { AlertWriterService } from './alert-writer.service';
import { ATTENTION_RECHECK, AttentionRecheckPayload } from './attention-events';

/** D34: a rule runs unless the school switched it off AND the rule is allowed to be switched off. */
export function isRuleEnabled(meta: AlertRuleMeta, settings: AttentionSettings): boolean {
  return !meta.canDisable || settings.rules[meta.key]?.enabled !== false;
}

async function withBudget<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('rule budget exceeded')), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Registers the attention cadences on boot and is the queue's worker.
 * Clone of AbsenceNoticeScheduler's shape; `upsertJobScheduler` is idempotent
 * so restarts do not duplicate schedulers. (D11, D12)
 */
@Injectable()
@Processor(ATTENTION_QUEUE, { concurrency: 2 })
export class AttentionScheduler extends WorkerHost implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttentionScheduler.name);

  constructor(
    @InjectQueue(ATTENTION_QUEUE) private readonly queue: Queue,
    @InjectRepository(School) private readonly schools: Repository<School>,
    private readonly registry: RuleRegistryService,
    private readonly context: RuleContextService,
    private readonly writer: AlertWriterService,
    @Inject(TENANT_STATUS_REDIS) private readonly redis: Redis,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    super();
  }

  private readonly onRecheck = (p: AttentionRecheckPayload) => {
    // Deduplication (not a fixed jobId): edits within the 5s window collapse into one
    // delayed job, but an edit arriving while the job runs still queues a new one.
    void this.queue
      .add(JOB_RECHECK, p, {
        deduplication: {
          id: `recheck-${p.tenantId}-${p.ruleKey}`,
          ttl: 5000,
          extend: true,
          replace: true,
        },
        delay: 5000,
        removeOnComplete: true,
        removeOnFail: true,
      })
      .catch((e) => this.logger.error(`recheck enqueue failed: ${String(e)}`));
  };

  onModuleDestroy(): void {
    attentionEvents.off(ATTENTION_RECHECK, this.onRecheck);
  }

  async onModuleInit(): Promise<void> {
    const opts = { removeOnComplete: true, removeOnFail: 100 };
    await this.queue.upsertJobScheduler(
      'attention-fast',
      { every: FAST_INTERVAL_MS },
      { name: JOB_FAST, opts },
    );
    await this.queue.upsertJobScheduler(
      'attention-hourly',
      { every: HOURLY_INTERVAL_MS },
      { name: JOB_HOURLY, opts },
    );
    await this.queue.upsertJobScheduler(
      'attention-daily',
      { every: DAILY_TICK_MS },
      { name: JOB_DAILY, opts },
    );
    attentionEvents.on(ATTENTION_RECHECK, this.onRecheck);
    this.logger.log('Scheduled attention fast/hourly/daily sweeps');
  }

  async process(job: Job): Promise<void> {
    if (job.name === JOB_RECHECK) {
      try {
        return await this.runRecheck(job.data, new Date());
      } catch (e) {
        this.logger.error(`Recheck failed for ${job.data?.tenantId}: ${String(e)}`);
        return;
      }
    }
    if (job.name === JOB_FAST) return this.runCadence(AlertCadence.FAST, new Date());
    if (job.name === JOB_HOURLY) return this.runCadence(AlertCadence.HOURLY, new Date());
    if (job.name === JOB_DAILY) return this.runCadence(AlertCadence.DAILY, new Date());
  }

  async runCadence(cadence: AlertCadence, now: Date): Promise<void> {
    const startedAt = Date.now();
    const tenants = await this.schools.find({ select: { id: true }, where: { status: 'ACTIVE' } });
    let failures = 0;
    let next = 0;
    const worker = async () => {
      while (next < tenants.length) {
        const { id } = tenants[next++];
        await new Promise((r) => setTimeout(r, Math.random() * ATTENTION_JITTER_MS));
        try {
          await this.sweepTenant(id, cadence, now);
        } catch (e) {
          failures++;
          this.logger.error(`Attention ${cadence} sweep failed for tenant ${id}: ${String(e)}`);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(ATTENTION_TENANT_CONCURRENCY, tenants.length) }, worker),
    );
    const durationMs = Date.now() - startedAt;
    try {
      await this.redis.set(
        attentionKeys.heartbeat(cadence),
        JSON.stringify({
          at: new Date().toISOString(),
          durationMs,
          tenants: tenants.length,
          failures,
        }),
      );
    } catch (e) {
      this.logger.error(`heartbeat write failed: ${String(e)}`);
    }
    attentionEvents.emit(ATTENTION_SWEEP_DONE, {
      cadence,
      startedAt: new Date(startedAt),
      durationMs,
      tenants: tenants.length,
      failures,
    });
    this.logger.log(`Attention ${cadence} sweep: ${tenants.length} tenants in ${durationMs}ms`);
  }

  async sweepTenant(tenantId: string, cadence: AlertCadence, now: Date): Promise<void> {
    const ctx = await this.context.build(tenantId, now);
    if (cadence === AlertCadence.FAST) {
      await this.writer.expireDue(tenantId, now);
      await this.writer.wakeSnoozed(tenantId, now);
      if (!ctx.isWorkingDay || !(await this.context.isWithinSchoolHours(ctx))) return;
    }
    for (const rule of this.registry.forCadence(cadence)) {
      const key = rule.meta.key;
      if (!isRuleEnabled(rule.meta, ctx.settings)) {
        await this.writer.withdrawRule(tenantId, key);
        continue;
      }
      if (cadence === AlertCadence.DAILY) {
        const slot = EVENING_RULE_KEYS.has(key) ? ctx.settings.eveningAt : ctx.settings.dailyAt;
        if (ctx.localTime < slot) continue;
        if (!(await this.claimDaily(tenantId, key, ctx.localDate))) continue;
      }
      const ok = await this.runRule(ctx, rule);
      // A failed DAILY run must be retried on the next tick, not skipped until tomorrow.
      if (!ok && cadence === AlertCadence.DAILY)
        await this.releaseDaily(tenantId, key, ctx.localDate);
    }
    if (
      cadence === AlertCadence.DAILY &&
      (await this.claimDaily(tenantId, 'prune', ctx.localDate))
    ) {
      await this.prune(tenantId, now);
    }
  }

  /** SET NX once per local day; if Redis is down, skip (never double-run). */
  private async claimDaily(tenantId: string, key: string, localDate: string): Promise<boolean> {
    try {
      const r = await this.redis.set(
        attentionKeys.dailyMarker(tenantId, key, localDate),
        '1',
        'EX',
        DAILY_MARKER_TTL_SECONDS,
        'NX',
      );
      return r === 'OK';
    } catch (e) {
      this.logger.error(`daily marker failed: ${String(e)}`);
      return false;
    }
  }

  private async releaseDaily(tenantId: string, key: string, localDate: string): Promise<void> {
    try {
      await this.redis.del(attentionKeys.dailyMarker(tenantId, key, localDate));
    } catch (e) {
      this.logger.error(`daily marker release failed: ${String(e)}`);
    }
  }

  private async prune(tenantId: string, now: Date): Promise<void> {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - ATTENTION_RETENTION_MONTHS);
    await this.dataSource.query(
      `DELETE FROM alerts WHERE tenant_id = $1 AND status <> 'ACTIVE' AND COALESCE(resolved_at, raised_at) < $2`,
      [tenantId, cutoff],
    );
  }

  /** Returns false when the rule failed (recorded, never thrown). */
  async runRule(ctx: RuleContext, rule: AttentionRule): Promise<boolean> {
    try {
      // ponytail: the losing evaluate keeps running in the background; cancel via AbortSignal if it ever matters.
      const findings = await withBudget(rule.evaluate(ctx), ATTENTION_RULE_BUDGET_MS);
      await this.writer.apply(ctx, rule, findings);
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`Rule ${rule.meta.key} failed for tenant ${ctx.tenantId}: ${message}`);
      try {
        const k = attentionKeys.failingRule(rule.meta.key);
        await this.redis.hincrby(k, 'count', 1);
        await this.redis.hset(
          k,
          'lastError',
          message.slice(0, 200),
          'lastAt',
          new Date().toISOString(),
        );
        await this.redis.expire(k, 86_400);
      } catch (re) {
        this.logger.error(`failing-rule record failed: ${String(re)}`);
      }
      return false;
    }
  }

  async runRecheck(
    { tenantId, ruleKey, actorUserId }: AttentionRecheckPayload,
    now: Date,
  ): Promise<void> {
    const rule = this.registry.get(ruleKey);
    if (!rule || !rule.meta.cadence.includes(AlertCadence.ON_CHANGE)) return;
    const school = await this.schools.findOne({
      select: { id: true },
      where: { id: tenantId, status: 'ACTIVE' },
    });
    if (!school) return;
    const ctx = await this.context.build(tenantId, now, actorUserId);
    if (!isRuleEnabled(rule.meta, ctx.settings)) {
      await this.writer.withdrawRule(tenantId, ruleKey);
      return;
    }
    await this.runRule(ctx, rule);
  }
}
