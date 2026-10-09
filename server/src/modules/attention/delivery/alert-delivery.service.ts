import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { AlertSeverity, alertRuleMeta, isAlertRuleKey } from '@biddaloy/shared';
import { PushService } from '../../push/push.service';
import { SchoolsService } from '../../schools/schools.service';
import { localDate } from '../../attendance/attendance-policy.util';
import { AttentionQueryService } from '../api/attention-query.service';
import {
  ATTENTION_DELIVERY_QUEUE,
  ATTENTION_RECIPIENTS_OPENED,
  AttentionRecipientsOpenedPayload,
  JOB_DELIVER_PUSH,
  attentionEvents,
} from '../attention.constants';
import { resolveLocale } from '../rules/messages';
import { addDaysIso, localDateTimeToUtc, localTimeHHmm } from '../rules/rule-context.service';

interface Quiet {
  start: string;
  end: string;
}

/** HH:mm strings compare lexically. start === end means "no quiet hours". */
export function isInQuietHours(hhmm: string, q: Quiet): boolean {
  if (q.start === q.end) return false;
  if (q.start < q.end) return q.start <= hhmm && hhmm < q.end;
  return hhmm >= q.start || hhmm < q.end;
}

/** Next instant quiet hours end, as UTC. Call only when `now` is inside quiet hours. */
export function quietHoursEnd(now: Date, tz: string, q: Quiet): Date {
  const today = localDate(now, tz);
  const wrapsToTomorrow = q.start > q.end && localTimeHHmm(now, tz) >= q.start;
  return localDateTimeToUtc(wrapsToTomorrow ? addDaysIso(today, 1) : today, q.end, tz);
}

/** Web push for newly OPEN recipients (D8, D23, D26). Never sends SMS. */
@Injectable()
@Processor(ATTENTION_DELIVERY_QUEUE)
export class AlertDeliveryService extends WorkerHost implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertDeliveryService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(ATTENTION_DELIVERY_QUEUE) private readonly queue: Queue,
    private readonly push: PushService,
    private readonly schools: SchoolsService,
    private readonly query: AttentionQueryService,
  ) {
    super();
  }

  private readonly onOpened = (p: AttentionRecipientsOpenedPayload) => {
    void this.deliver(p.tenantId, p.recipientIds).catch((e) =>
      this.logger.error(
        `attention delivery failed for ${p.tenantId}`,
        e instanceof Error ? e.stack : String(e),
      ),
    );
  };

  onModuleInit(): void {
    attentionEvents.on(ATTENTION_RECIPIENTS_OPENED, this.onOpened);
  }

  onModuleDestroy(): void {
    attentionEvents.off(ATTENTION_RECIPIENTS_OPENED, this.onOpened);
  }

  async process(job: Job<{ tenantId: string; recipientId: string }>): Promise<void> {
    if (job.name !== JOB_DELIVER_PUSH) return;
    // The delay already ran to the end of quiet hours. Re-checking here could
    // re-queue under the same jobId while this job is still active, and BullMQ
    // drops that duplicate, so the push would be lost.
    await this.deliver(job.data.tenantId, [job.data.recipientId], new Date(), true);
  }

  async deliver(
    tenantId: string,
    recipientIds: string[],
    now = new Date(),
    deferred = false,
  ): Promise<void> {
    if (recipientIds.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: Record<string, any>[] = await this.dataSource.query(
      `SELECT r.id, r.user_id, r.role, a.rule_key, a.source, a.severity, a.category, a.params,
              a.action_url, a.manual_title, a.manual_body, u.preferences
         FROM alert_recipients r
         JOIN alerts a ON a.id = r.alert_id AND a.tenant_id = r.tenant_id
         JOIN users u ON u.id = r.user_id
        WHERE r.tenant_id = $1 AND r.id = ANY($2::uuid[]) AND r.state = 'OPEN'
          AND r.pushed_at IS NULL AND a.status = 'ACTIVE'`,
      [tenantId, recipientIds],
    );
    if (rows.length === 0) return;

    const settings = await this.schools.getResolvedSettings(tenantId);
    // The resolver always fills region/attention (same assumption as RuleContextService).
    const tz = settings.region!.timezone;
    const locale = resolveLocale(settings.region!.locale);
    const quiet = settings.attention!.quietHours!;
    const quietNow = !deferred && isInQuietHours(localTimeHHmm(now, tz), quiet);

    for (const row of rows) {
      if (!isAlertRuleKey(row.rule_key) || !alertRuleMeta(row.rule_key).pushable) continue;
      const muted: string[] = row.preferences?.notifications?.mutedCategories ?? [];
      if (muted.includes(row.category) && row.severity !== AlertSeverity.CRITICAL) continue;

      if (quietNow) {
        await this.queue.add(
          JOB_DELIVER_PUSH,
          { tenantId, recipientId: row.id },
          {
            jobId: `push-${row.id}`,
            delay: quietHoursEnd(now, tz, quiet).getTime() - now.getTime(),
            // Retries are safe (deliver re-checks pushed_at and claims atomically). A failed job
            // must not linger: under the fixed jobId it would swallow this recipient's next push.
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
        continue;
      }

      // Claim atomically before sending so concurrent deliveries push once.
      // Stamped even if no device accepts: attempted once, no retry storm.
      const [, claimed] = await this.dataSource.query(
        `UPDATE alert_recipients SET pushed_at = $3
          WHERE tenant_id = $1 AND id = $2 AND pushed_at IS NULL`,
        [tenantId, row.id, now],
      );
      if (!claimed) continue;

      const { title, why } = this.query.renderAlert(row, locale);
      await this.push
        .sendToUser(row.user_id, tenantId, {
          type: `attention.${row.rule_key}`,
          title,
          body: why,
          url:
            row.action_url ??
            (row.role === 'PARENT' || row.role === 'STUDENT'
              ? '/portal' // no portal notifications page yet (wave 2)
              : '/notifications'),
        })
        .catch((e) => this.logger.warn(`attention push failed: ${String(e)}`));
    }
  }
}
