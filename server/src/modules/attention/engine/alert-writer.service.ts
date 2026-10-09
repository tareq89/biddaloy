import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import Redis from 'ioredis';
import { AlertRuleKey, AlertSeverity, UserRole } from '@biddaloy/shared';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';
import {
  ATTENTION_RECIPIENTS_OPENED,
  AttentionRecipientsOpenedPayload,
  DEFAULT_ALERT_TTL_DAYS,
  attentionEvents,
  attentionKeys,
} from '../attention.constants';
import type { AttentionRule, RuleContext, RuleFinding } from '../rules/rule.types';

const DAY_MS = 86_400_000;
const RANK: Record<string, number> = {
  [AlertSeverity.REMINDER]: 0,
  [AlertSeverity.WARNING]: 1,
  [AlertSeverity.CRITICAL]: 2,
};

type Recipient = RuleFinding['recipients'][number];
type Row = Record<string, any>;

interface AlertInsert {
  tenantId: string;
  ruleKey: string;
  source: 'RULE';
  severity: string;
  category: string;
  dedupeKey: string;
  subject?: { type: string; id: string };
  params: Record<string, string | number>;
  actionUrl?: string;
  escalationLevel: number;
  now: Date;
  expiresAt: Date;
  recipients: Recipient[];
}

export interface ApplyResult {
  created: number;
  updated: number;
  resolved: number;
  openedRecipientIds: string[];
}

/** Stable-key JSON so jsonb key order never looks like a change. */
const stable = (o: Record<string, unknown>) =>
  JSON.stringify(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );
const rcpKey = (userId: string, studentId?: string | null) => `${userId}|${studentId ?? ''}`;

/** TypeORM returns `[rows, count]` for UPDATE ... RETURNING; normalise to rows. */
async function run(em: EntityManager, sql: string, params: unknown[]): Promise<Row[]> {
  const r = await em.query(sql, params);
  return r.length === 2 && Array.isArray(r[0]) && typeof r[1] === 'number' ? r[0] : r;
}

const ALERT_COLS = `id, dedupe_key, severity, escalation_level, params, action_url, expires_at`;
const LIVE_RECIPIENTS = `SELECT id, alert_id, user_id, student_id, state FROM alert_recipients
  WHERE tenant_id = $1 AND alert_id = ANY($2::uuid[]) AND state IN ('OPEN','HIDDEN')`;

/**
 * [67.1.04] Turns one rule run's findings into alert rows. Every statement carries
 * `tenant_id`. MANUAL alerts are never loaded or touched by `apply`.
 */
@Injectable()
export class AlertWriterService {
  private readonly logger = new Logger(AlertWriterService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(TENANT_STATUS_REDIS) private readonly redis: Redis,
  ) {}

  async apply(
    ctx: RuleContext,
    rule: AttentionRule,
    findings: RuleFinding[],
  ): Promise<ApplyResult> {
    const { tenantId, now } = ctx;
    const { key: ruleKey, severity: metaSeverity, category } = rule.meta;
    const byKey = new Map(findings.map((f) => [f.dedupeKey, f])); // last wins
    const opened: string[] = [];
    const touched = new Set<string>();
    let created = 0;
    let updated = 0;
    let resolved = 0;

    await this.dataSource.transaction(async (em) => {
      // serialize concurrent runs of the same tenant+rule (else OPEN recipients can land on a RESOLVED alert)
      await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${tenantId}:${ruleKey}`]);
      const loadActive = (dedupeKey?: string) =>
        run(
          em,
          `SELECT ${ALERT_COLS} FROM alerts
            WHERE tenant_id = $1 AND rule_key = $2 AND source = 'RULE' AND status = 'ACTIVE'
              ${dedupeKey ? 'AND dedupe_key = $3' : ''}`,
          dedupeKey ? [tenantId, ruleKey, dedupeKey] : [tenantId, ruleKey],
        );
      const existing = new Map((await loadActive()).map((a) => [a.dedupe_key as string, a]));
      const stored = new Map<string, Row[]>(); // alert id -> OPEN/HIDDEN recipients
      const loadRecipients = async (alertIds: string[]) => {
        for (const r of await run(em, LIVE_RECIPIENTS, [tenantId, alertIds])) {
          if (!stored.has(r.alert_id)) stored.set(r.alert_id, []);
          stored.get(r.alert_id)!.push(r);
        }
      };
      if (existing.size) await loadRecipients([...existing.values()].map((a) => a.id));

      for (const f of byKey.values()) {
        const recipients = [
          ...new Map(f.recipients.map((r) => [rcpKey(r.userId, r.studentId), r])).values(),
        ];
        const severity = f.severity ?? metaSeverity;
        const escalationLevel = f.escalationLevel ?? 0;
        const defaultExpiry = new Date(now.getTime() + DEFAULT_ALERT_TTL_DAYS * DAY_MS);

        let alert = existing.get(f.dedupeKey);
        if (!alert) {
          const id = await this.insertAlertWithRecipients(
            em,
            {
              tenantId,
              ruleKey,
              source: 'RULE',
              severity,
              category,
              dedupeKey: f.dedupeKey,
              subject: f.subject,
              params: f.params,
              actionUrl: f.actionUrl,
              escalationLevel,
              now,
              expiresAt: f.expiresAt ?? defaultExpiry,
              recipients,
            },
            opened,
            touched,
          );
          if (id) {
            created++;
            continue;
          }
          // a concurrent run won the insert: carry on as "existing"
          alert = (await loadActive(f.dedupeKey))[0];
          if (!alert) continue;
          await loadRecipients([alert.id]);
        }

        // d. update only what differs (D7)
        const sets: string[] = [];
        const vals: unknown[] = [tenantId, alert.id];
        const set = (col: string, v: unknown, cast = '') => {
          vals.push(v);
          sets.push(`${col} = $${vals.length}${cast}`);
        };
        if (alert.severity !== severity) set('severity', severity);
        if (alert.escalation_level !== escalationLevel) set('escalation_level', escalationLevel);
        if (stable(alert.params ?? {}) !== stable(f.params))
          set('params', JSON.stringify(f.params), '::jsonb');
        if ((alert.action_url ?? null) !== (f.actionUrl ?? null))
          set('action_url', f.actionUrl ?? null);
        const storedExp: Date | null = alert.expires_at;
        if (f.expiresAt) {
          if (storedExp?.getTime() !== f.expiresAt.getTime()) set('expires_at', f.expiresAt);
        } else if (!storedExp || storedExp.getTime() < now.getTime() + 2 * DAY_MS) {
          set('expires_at', defaultExpiry);
        }
        if (sets.length) {
          await em.query(
            `UPDATE alerts SET ${sets.join(', ')}, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
            vals,
          );
          updated++;
        }

        // f. recipients the finding no longer names -> RESOLVED
        const wanted = new Set(recipients.map((r) => rcpKey(r.userId, r.studentId)));
        const current = stored.get(alert.id) ?? [];
        const dropped = current
          .filter((r) => !wanted.has(rcpKey(r.user_id, r.student_id)))
          .map((r) => r.id);
        if (dropped.length) {
          const rows = await run(
            em,
            `UPDATE alert_recipients SET state = 'RESOLVED', resolved_at = $3, updated_at = now()
              WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND state IN ('OPEN','HIDDEN') RETURNING user_id`,
            [tenantId, dropped, now],
          );
          rows.forEach((r) => touched.add(r.user_id));
        }

        // e. escalation (D21): wake hidden, re-arm push, re-announce live recipients
        if (RANK[severity] > RANK[alert.severity] || escalationLevel > alert.escalation_level) {
          const rows = await run(
            em,
            `UPDATE alert_recipients
                SET state = 'OPEN', hidden_at = NULL, snoozed_until = NULL, pushed_at = NULL, updated_at = now()
              WHERE tenant_id = $1 AND alert_id = $2 AND state IN ('OPEN','HIDDEN') RETURNING id, user_id`,
            [tenantId, alert.id],
          );
          rows.forEach((r) => {
            opened.push(r.id);
            touched.add(r.user_id);
          });
        }

        // f. recipients the finding names that are not stored yet -> insert
        const have = new Set(current.map((r) => rcpKey(r.user_id, r.student_id)));
        await this.insertRecipients(
          em,
          tenantId,
          alert.id,
          recipients.filter((r) => !have.has(rcpKey(r.userId, r.studentId))),
          opened,
          touched,
        );
      }

      // g. resolve what disappeared (D20: actor only on an ON_CHANGE recheck)
      const gone = [...existing.values()].filter((a) => !byKey.has(a.dedupe_key)).map((a) => a.id);
      if (gone.length) {
        const res = await run(
          em,
          `UPDATE alerts SET status = 'RESOLVED', resolved_at = $3, resolved_by_user_id = $4, updated_at = now()
            WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status = 'ACTIVE' RETURNING id`,
          [tenantId, gone, now, ctx.actorUserId ?? null],
        );
        resolved = res.length;
        const rows = await run(
          em,
          `UPDATE alert_recipients SET state = 'RESOLVED', resolved_at = $3, updated_at = now()
            WHERE tenant_id = $1 AND alert_id = ANY($2::uuid[]) AND state IN ('OPEN','HIDDEN') RETURNING user_id`,
          [tenantId, gone, now],
        );
        rows.forEach((r) => touched.add(r.user_id));
      }

      // h. freshness stamp (no updated_at bump: not a content change)
      await em.query(
        `UPDATE alerts SET last_evaluated_at = $3
          WHERE tenant_id = $1 AND rule_key = $2 AND source = 'RULE' AND status = 'ACTIVE'`,
        [tenantId, ruleKey, now],
      );
    });

    await this.afterCommit(tenantId, opened, touched);
    return { created, updated, resolved, openedRecipientIds: opened };
  }

  /** Expire due ACTIVE alerts (and their live recipients) for one tenant. */
  expireDue(tenantId: string, now: Date): Promise<number> {
    return this.closeAlerts(tenantId, now, 'EXPIRED', `status = 'ACTIVE' AND expires_at <= $2`, [
      now,
    ]);
  }

  /** School switched the rule off (D34). */
  withdrawRule(tenantId: string, ruleKey: AlertRuleKey): Promise<number> {
    return this.closeAlerts(
      tenantId,
      new Date(),
      'WITHDRAWN',
      `status = 'ACTIVE' AND source = 'RULE' AND rule_key = $2`,
      [ruleKey],
    );
  }

  /** Snooze elapsed -> OPEN again. No OPENED event: a woken item is not re-pushed (D28). */
  async wakeSnoozed(tenantId: string, now: Date): Promise<number> {
    const rows = await run(
      this.dataSource.manager,
      `UPDATE alert_recipients SET state = 'OPEN', snoozed_until = NULL, hidden_at = NULL, updated_at = now()
        WHERE tenant_id = $1 AND state = 'HIDDEN' AND snoozed_until IS NOT NULL AND snoozed_until <= $2
        RETURNING user_id`,
      [tenantId, now],
    );
    await this.invalidateSummary(
      tenantId,
      rows.map((r) => r.user_id),
    );
    return rows.length;
  }

  async invalidateSummary(tenantId: string, userIds: string[]): Promise<void> {
    const users = [...new Set(userIds)];
    if (!users.length) return;
    const keys = users.flatMap((u) =>
      Object.values(UserRole).map((role) => attentionKeys.summary(tenantId, u, role)),
    );
    try {
      await this.redis.del(...keys);
    } catch (err) {
      // fails fast when Redis is down; a missed invalidation = <= 60 s staleness
      this.logger.warn(`summary invalidation failed: ${(err as Error).message}`);
    }
  }

  /** Reusable by the W5 manual composer. Returns the alert id, or null on dedupe conflict. */
  private async insertAlertWithRecipients(
    em: EntityManager,
    a: AlertInsert,
    opened: string[],
    touched: Set<string>,
  ): Promise<string | null> {
    const rows = await run(
      em,
      `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, dedupe_key, subject_type, subject_id,
                           params, action_url, escalation_level, raised_at, last_evaluated_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$12,$13)
       ON CONFLICT (tenant_id, rule_key, dedupe_key) WHERE status = 'ACTIVE' DO NOTHING RETURNING id`,
      [
        a.tenantId,
        a.ruleKey,
        a.source,
        a.severity,
        a.category,
        a.dedupeKey,
        a.subject?.type ?? null,
        a.subject?.id ?? null,
        JSON.stringify(a.params),
        a.actionUrl ?? null,
        a.escalationLevel,
        a.now,
        a.expiresAt,
      ],
    );
    if (!rows.length) return null;
    await this.insertRecipients(em, a.tenantId, rows[0].id, a.recipients, opened, touched);
    return rows[0].id;
  }

  private async insertRecipients(
    em: EntityManager,
    tenantId: string,
    alertId: string,
    recipients: Recipient[],
    opened: string[],
    touched: Set<string>,
  ): Promise<void> {
    if (!recipients.length) return;
    const rows = await run(
      em,
      `INSERT INTO alert_recipients (tenant_id, alert_id, user_id, role, student_id)
       SELECT $1, $2, t.u, t.r, t.s FROM unnest($3::uuid[], $4::text[], $5::uuid[]) AS t(u, r, s)
       ON CONFLICT (alert_id, user_id, student_id) DO UPDATE
         SET state = 'OPEN', resolved_at = NULL, hidden_at = NULL, snoozed_until = NULL, pushed_at = NULL, updated_at = now()
         WHERE alert_recipients.state IN ('RESOLVED','EXPIRED')
       RETURNING id, user_id`,
      [
        tenantId,
        alertId,
        recipients.map((r) => r.userId),
        recipients.map((r) => r.role ?? null),
        recipients.map((r) => r.studentId ?? null),
      ],
    );
    rows.forEach((r) => {
      opened.push(r.id);
      touched.add(r.user_id);
    });
  }

  /** Invalidate caches, then tell the engine which recipients just became OPEN. */
  private async afterCommit(
    tenantId: string,
    opened: string[],
    touched: Set<string>,
  ): Promise<void> {
    await this.invalidateSummary(tenantId, [...touched]);
    if (opened.length) {
      const payload: AttentionRecipientsOpenedPayload = { tenantId, recipientIds: opened };
      attentionEvents.emit(ATTENTION_RECIPIENTS_OPENED, payload);
    }
  }

  private async closeAlerts(
    tenantId: string,
    now: Date,
    status: 'EXPIRED' | 'WITHDRAWN',
    where: string,
    extra: unknown[],
  ): Promise<number> {
    const users: string[] = [];
    let n = 0;
    await this.dataSource.transaction(async (em) => {
      const alerts = await run(
        em,
        `UPDATE alerts SET status = '${status}', updated_at = now()
          WHERE tenant_id = $1 AND ${where} RETURNING id`,
        [tenantId, ...extra],
      );
      n = alerts.length;
      if (!n) return;
      const rows = await run(
        em,
        `UPDATE alert_recipients SET state = 'EXPIRED', resolved_at = $3, updated_at = now()
          WHERE tenant_id = $1 AND alert_id = ANY($2::uuid[]) AND state IN ('OPEN','HIDDEN') RETURNING user_id`,
        [tenantId, alerts.map((a) => a.id), now],
      );
      rows.forEach((r) => users.push(r.user_id));
    });
    await this.invalidateSummary(tenantId, users);
    return n;
  }
}
