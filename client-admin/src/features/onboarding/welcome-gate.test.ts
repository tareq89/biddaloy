import type { OnboardingStatus } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { shouldGoToWelcome } from './welcome-gate';

const status = (over: Partial<OnboardingStatus> = {}): OnboardingStatus => ({
  finished_at: null,
  dismissed_at: null,
  seen: false,
  setup_path: null,
  items: [],
  counts: { classes: 0, sections: 0, students: 0, staff: 0 },
  trial: null,
  support_url: null,
  ...over,
});

describe('shouldGoToWelcome', () => {
  it('sends a fresh ADMIN landing on the dashboard', () => {
    expect(shouldGoToWelcome('ADMIN', '/dashboard', status())).toBe(true);
  });
  it('never hijacks a deep link', () => {
    expect(shouldGoToWelcome('ADMIN', '/invoices/abc', status())).toBe(false);
  });
  it('never sends a non-admin', () => {
    expect(shouldGoToWelcome('TEACHER', '/dashboard', status())).toBe(false);
  });
  it.each([
    ['seen', { seen: true }],
    ['dismissed', { dismissed_at: '2026-01-01' }],
    ['finished', { finished_at: '2026-01-01' }],
  ])('stops once %s', (_n, over) => {
    expect(shouldGoToWelcome('ADMIN', '/dashboard', status(over))).toBe(false);
  });
  it('waits for the status to load', () => {
    expect(shouldGoToWelcome('ADMIN', '/dashboard', undefined)).toBe(false);
  });
});
