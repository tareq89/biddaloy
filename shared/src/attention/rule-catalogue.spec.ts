import { describe, expect, it } from 'vitest';

import { AlertCadence, AlertCategory, AlertSeverity } from '../enums/attention';
import { UserRole } from '../enums/index';
import {
  ALERT_RULE_KEYS,
  ALERT_RULES,
  alertRuleMeta,
  isAlertRuleKey,
  type AlertRuleKey,
} from './rule-catalogue';

const meta = (k: string) => ALERT_RULES.find((r) => r.key === k)!;

describe('alert rule catalogue', () => {
  it('has 58 unique, well-formed keys that match ALERT_RULE_KEYS in order', () => {
    expect(ALERT_RULES).toHaveLength(58);
    expect(new Set(ALERT_RULE_KEYS).size).toBe(58);
    expect(ALERT_RULES.map((r) => r.key)).toEqual([...ALERT_RULE_KEYS]);
    for (const k of ALERT_RULE_KEYS) expect(k).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it('does not contain incidents.open', () => {
    expect(isAlertRuleKey('incidents.open')).toBe(false);
  });

  it('critical and escalating rules cannot be disabled (D34)', () => {
    const escalating = [
      'trial.ending',
      'attendance.not_taken',
      'exams.marks_overdue',
      'exams.my_marks_due',
      'billing.renewal_due',
    ];
    for (const r of ALERT_RULES) {
      if (r.severity === AlertSeverity.CRITICAL || escalating.includes(r.key)) {
        expect(r.canDisable, r.key).toBe(false);
      }
    }
  });

  it('guardian SMS fallback only on child.absent_today and fees.overdue_family (D29, D42)', () => {
    expect(ALERT_RULES.filter((r) => r.guardianSmsFallback).map((r) => r.key)).toEqual([
      'child.absent_today',
      'fees.overdue_family',
    ]);
  });

  it('PLATFORM category <=> roles [SUPER_ADMIN]; nobody else lists SUPER_ADMIN', () => {
    for (const r of ALERT_RULES) {
      const platform = r.category === AlertCategory.PLATFORM;
      expect(r.roles.includes(UserRole.SUPER_ADMIN), r.key).toBe(platform);
      if (platform) expect(r.roles).toEqual([UserRole.SUPER_ADMIN]);
    }
  });

  it('every rule except manual.alert has a cadence; leave.my_request_decided is personal', () => {
    for (const r of ALERT_RULES) {
      if (r.key === 'manual.alert') expect(r.cadence).toEqual([]);
      else expect(r.cadence.length, r.key).toBeGreaterThan(0);
    }
    expect(meta('leave.my_request_decided').roles).toEqual([]);
    expect(meta('attendance.not_taken').cadence).toContain(AlertCadence.FAST);
  });

  it('ownerEpic is set on exactly the 8 later-epic rows', () => {
    expect(
      ALERT_RULES.filter((r) => r.ownerEpic)
        .map((r) => r.key)
        .sort(),
    ).toEqual(
      [
        'study_plan.unreported',
        'study_plan.behind',
        'admin.mfa_missing',
        'approvals.pending',
        'print.queue_pending',
        'billing.renewal_due',
        'students.at_risk',
        'committee.monthly_report_ready',
      ].sort(),
    );
  });

  it('lookup returns the catalogue object; unknown key throws', () => {
    expect(alertRuleMeta('class.starting')).toBe(meta('class.starting'));
    expect(() => alertRuleMeta('nope' as AlertRuleKey)).toThrow();
    expect(isAlertRuleKey('nope')).toBe(false);
    expect(isAlertRuleKey('class.starting')).toBe(true);
  });
});
