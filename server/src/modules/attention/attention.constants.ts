import { EventEmitter } from 'events';
import type { AlertCadence, AlertRuleKey } from '@biddaloy/shared';

export const ATTENTION_QUEUE = 'attention';
export const ATTENTION_DELIVERY_QUEUE = 'attention-delivery';

export const JOB_FAST = 'fast';
export const JOB_HOURLY = 'hourly';
export const JOB_DAILY = 'daily';
export const JOB_RECHECK = 'recheck';
export const JOB_DELIVER_PUSH = 'deliver-push';

export const FAST_INTERVAL_MS = 5 * 60_000;
export const HOURLY_INTERVAL_MS = 60 * 60_000;
export const DAILY_TICK_MS = 15 * 60_000; // D7

export const ATTENTION_RULE_BUDGET_MS = 10_000;
export const ATTENTION_STALE_AFTER_MS = 15 * 60_000; // D12
export const ATTENTION_SUMMARY_TTL_SECONDS = 60;
export const DEFAULT_ALERT_TTL_DAYS = 7;
export const ATTENTION_RETENTION_MONTHS = 12; // D31
export const ATTENTION_TENANT_CONCURRENCY = 4;
export const ATTENTION_JITTER_MS = 1000;
export const DAILY_MARKER_TTL_SECONDS = 3 * 86_400;

/** DAILY rules that run at `eveningAt` instead of `dailyAt`. */
export const EVENING_RULE_KEYS: ReadonlySet<AlertRuleKey> = new Set<AlertRuleKey>([
  'homework.due_tomorrow',
  'exams.tomorrow',
  'calendar.holiday_tomorrow',
]);

/** Redis keys. Tenant data is tenant-prefixed; heartbeat/failing are global ops keys. */
export const attentionKeys = {
  dailyMarker: (tenantId: string, ruleKeyOrJob: string, localDate: string) =>
    `tenant:${tenantId}:attention:daily:${ruleKeyOrJob}:${localDate}`,
  summary: (tenantId: string, userId: string, role: string) =>
    `tenant:${tenantId}:attention:summary:${userId}:${role}`,
  heartbeat: (cadence: string) => `attention:heartbeat:${cadence}`,
  failingRule: (ruleKey: string) => `attention:failing:${ruleKey}`,
};

export const ATTENTION_RECIPIENTS_OPENED = 'attention.recipients.opened';
export const ATTENTION_SWEEP_DONE = 'attention.sweep.done';

export interface AttentionRecipientsOpenedPayload {
  tenantId: string;
  recipientIds: string[];
}

export interface AttentionSweepDonePayload {
  cadence: AlertCadence;
  startedAt: Date;
  durationMs: number;
  tenants: number;
  failures: number;
}

export const attentionEvents = new EventEmitter();
attentionEvents.setMaxListeners(50);
