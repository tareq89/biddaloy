import { describe, expect, it } from 'vitest';
import { RECONCILE_MAX_AGE_MS, isReconcilable } from './online-payments.reconciler';

const NOW = Date.parse('2026-11-15T00:00:00Z');
const row = (status: string, pid: string | null, ageMs: number) => ({
  status,
  provider_payment_id: pid,
  created_at: new Date(NOW - ageMs),
});

describe('isReconcilable', () => {
  it.each([
    ['PENDING', null, 1000, true],
    ['PENDING', 'p1', 1000, true],
    ['EXPIRED', 'p1', 1000, true],
    ['CANCELLED', 'p1', 1000, true],
    ['EXPIRED', null, 1000, false],
    ['CANCELLED', null, 1000, false],
    ['FAILED', 'p1', 1000, false],
    ['COMPLETED', 'p1', 1000, false],
    ['PENDING', 'p1', RECONCILE_MAX_AGE_MS, false],
    ['EXPIRED', 'p1', RECONCILE_MAX_AGE_MS + 1, false],
    ['EXPIRED', 'p1', RECONCILE_MAX_AGE_MS - 1, true],
  ])('%s pid=%s age=%s -> %s', (status, pid, age, want) => {
    expect(isReconcilable(row(status, pid, age), NOW)).toBe(want);
  });
});
