import { AlertCategory, AlertRecipientState, AlertSeverity, AlertSource } from '@biddaloy/shared';

import type {
  AlertItem,
  AttentionSummary,
  PlatformAttentionHealth,
  StudentAlert,
} from '../../api/attention';

import { FACTORY_REFERENCE_DATE, faker } from './faker';

export function alertItemFactory(overrides: Partial<AlertItem> = {}): AlertItem {
  return {
    recipientId: faker.string.uuid(),
    alertId: faker.string.uuid(),
    ruleKey: 'attendance.not_taken',
    source: AlertSource.RULE,
    severity: AlertSeverity.WARNING,
    category: AlertCategory.ATTENDANCE,
    state: AlertRecipientState.OPEN,
    title: '৭ম-খ শাখার উপস্থিতি নেওয়া হয়নি',
    why: 'আজকের প্রথম পিরিয়ড শেষ, কিন্তু উপস্থিতি জমা হয়নি।',
    steps: ['উপস্থিতি পাতা খুলুন', 'শাখা বেছে নিন', 'জমা দিন'],
    actionLabel: 'উপস্থিতি নিন',
    actionUrl: '/attendance',
    closable: true,
    raisedAt: FACTORY_REFERENCE_DATE.toISOString(),
    ...overrides,
  };
}

/** [100.4.04] The `sms.low` / `sms.expiring` alerts as #3865's rules raise them (admin-only; same buy link). */
export const SMS_BUY_URL = '/settings?section=communication&smsBuy=1';

export function smsAlertFactory(
  kind: 'low' | 'expiring' = 'low',
  overrides: Partial<AlertItem> = {},
): AlertItem {
  const low = kind === 'low';
  return alertItemFactory({
    ruleKey: low ? 'sms.low' : 'sms.expiring',
    severity: low ? AlertSeverity.CRITICAL : AlertSeverity.WARNING,
    category: AlertCategory.BILLING,
    title: low ? 'SMS credit is almost finished' : 'SMS credit expires soon',
    actionLabel: 'Buy SMS',
    actionUrl: SMS_BUY_URL,
    ...overrides,
  });
}

export function attentionSummaryFactory(
  overrides: Partial<AttentionSummary> = {},
): AttentionSummary {
  return {
    critical: 0,
    warning: 0,
    reminder: 0,
    activeTotal: 0,
    top: null,
    updatedAt: FACTORY_REFERENCE_DATE.toISOString(),
    staleMinutes: 0,
    ...overrides,
  };
}

export function studentAlertFactory(overrides: Partial<StudentAlert> = {}): StudentAlert {
  return {
    alertId: faker.string.uuid(),
    ruleKey: 'student.absent_streak',
    severity: AlertSeverity.WARNING,
    category: AlertCategory.ATTENDANCE,
    title: 'টানা ৩ দিন অনুপস্থিত',
    why: 'শিক্ষার্থী টানা তিন দিন স্কুলে আসেনি।',
    raisedAt: FACTORY_REFERENCE_DATE.toISOString(),
    seenCount: 0,
    recipientCount: 1,
    ...overrides,
  };
}

export function platformAttentionHealthFactory(
  overrides: Partial<PlatformAttentionHealth> = {},
): PlatformAttentionHealth {
  return {
    lastSweep: { FAST: null, HOURLY: null, DAILY: null },
    durationsMs: { FAST: null, HOURLY: null, DAILY: null },
    failingRules: [],
    ...overrides,
  };
}
