import { expect, test } from '@playwright/test';

import { a11yException } from './exceptions';

/** [8.5.5] The suppression protocol itself is under test: an expired
 * recheck date must fail loudly, not fade into permanence. */

test('a live exception returns the rule id for disableRules', () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  expect(a11yException('color-contrast', 'demo reason', future)).toBe('color-contrast');
});

test('an expired exception throws', () => {
  expect(() => a11yException('color-contrast', 'demo reason', '2020-01-01')).toThrow(/expired/);
});

test('a reason is mandatory', () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  expect(() => a11yException('color-contrast', '  ', future)).toThrow(/reason/);
});
