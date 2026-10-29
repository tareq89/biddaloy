import { describe, expect, it } from 'vitest';
import { ArrivalNoticeSubscription } from '../../../attendance/entities/arrival-notice-subscription.entity';
import { EXPECTED_TABS } from '../../codec/registry';
import { roundTrip } from '../people/ref-child-tab.test-helper';
import { arrivalNoticeSubscriptionsTab as tab } from './arrival-notice-subscriptions.tab';

const ID = '11111111-1111-4111-8111-111111111111';
const STUDENT = '22222222-2222-4222-8222-222222222222';
const GUARDIAN = '33333333-3333-4333-8333-333333333333';
const keys = { students: { [STUDENT]: 'REG-1' }, guardians: { [GUARDIAN]: '01711111111' } };
const stamp = { student: 'REG-1', guardian: '01711111111' };

describe('arrival_notice_subscriptions tab', () => {
  it('round-trips a row, keeping lock and consumed_at', () => {
    const entity = Object.assign(new ArrivalNoticeSubscription(), {
      id: ID,
      student_id: STUDENT,
      guardian_id: GUARDIAN,
      status: 'OFF',
      mode: 'ONCE',
      channel: 'SMS',
      lock: 'NEVER',
      consumed_at: new Date('2026-05-01T09:00:00.000Z'),
    });
    const row = roundTrip(tab, entity, stamp, keys);
    expect(row).toMatchObject({ student_id: STUDENT, guardian_id: GUARDIAN, lock: 'NEVER' });
    expect(tab.keyOf(entity)).toBe('REG-1|01711111111');
  });

  it('rejects an unknown enum value with a row error', () => {
    const res = tab.fromRow(
      {
        id: ID,
        student: 'REG-1',
        guardian: '01711111111',
        status: 'BOGUS',
        mode: 'ONCE',
        channel: 'SMS',
        lock: 'NONE',
      },
      2,
      { tenantId: 't', ref: () => 'x', warn: () => undefined },
    );
    expect('errors' in res && res.errors[0].column).toBe('status');
  });

  it.each([
    ['ALWAYS', 'OFF', 'RECURRING'],
    ['ALWAYS', 'ACTIVE', 'ONCE'],
  ])('rejects lock %s with status %s and mode %s (D35)', (lock, status, mode) => {
    const res = tab.fromRow(
      { id: ID, student: 'REG-1', guardian: '01711111111', status, mode, channel: 'PUSH', lock },
      2,
      { tenantId: 't', ref: () => 'x', warn: () => undefined },
    );
    expect('errors' in res && res.errors[0]).toMatchObject({ column: 'lock', severity: 'error' });
  });

  it.each([
    ['NEVER', 'ACTIVE', 'RECURRING', '', 'lock'],
    ['NEVER', 'REQUESTED', 'ONCE', '', 'lock'],
    ['ALWAYS', 'ACTIVE', 'RECURRING', '2026-05-01T09:00:00.000Z', 'consumed_at'],
  ])(
    'rejects lock %s with status %s, mode %s, consumed_at "%s" (D35)',
    (lock, status, mode, consumed_at, column) => {
      const res = tab.fromRow(
        {
          id: ID,
          student: 'REG-1',
          guardian: '01711111111',
          status,
          mode,
          channel: 'PUSH',
          lock,
          consumed_at,
        },
        2,
        { tenantId: 't', ref: () => 'x', warn: () => undefined },
      );
      expect('errors' in res && res.errors[0]).toMatchObject({ column, severity: 'error' });
    },
  );

  it('accepts a NEVER lock on an OFF row and an unconsumed ALWAYS row', () => {
    for (const row of [
      { lock: 'NEVER', status: 'OFF', mode: 'ONCE' },
      { lock: 'ALWAYS', status: 'ACTIVE', mode: 'RECURRING' },
    ]) {
      const res = tab.fromRow(
        { id: ID, student: 'REG-1', guardian: '01711111111', channel: 'PUSH', ...row },
        2,
        { tenantId: 't', ref: () => 'x', warn: () => undefined },
      );
      expect('errors' in res).toBe(false);
    }
  });

  it('is registered after its parents', () => {
    const at = EXPECTED_TABS.indexOf('arrival_notice_subscriptions');
    expect(at).toBeGreaterThan(EXPECTED_TABS.indexOf('students'));
    expect(at).toBeGreaterThan(EXPECTED_TABS.indexOf('guardians'));
  });
});
