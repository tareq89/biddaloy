import { expect, test } from '@playwright/test';

import { makeT, resolveNesting } from '../i18n';

// No app needed: pure string work, plus the real catalogs for the t() cases.
test('en: _one and _other resolve to the stock word', () => {
  const t = makeT('en');
  const m: Record<string, string> = {
    'common.entities.class_one': 'Class',
    'common.entities.class_other': 'Classes',
  };
  expect(resolveNesting('Open $t(common:entities.class_one)', (k) => m[k])).toBe('Open Class');
  expect(resolveNesting('All $t(common:entities.class_other)', (k) => m[k])).toBe('All Classes');
  expect(t('common.entities.class_other')).toBe('Classes');
});

test('bn: one word for both forms', () => {
  const lookup = (k: string) =>
    ({ 'common.entities.class_one': 'শ্রেণি', 'common.entities.class_other': 'শ্রেণি' })[k];
  expect(resolveNesting('$t(common:entities.class_one)', lookup)).toBe('শ্রেণি');
  expect(resolveNesting('$t(common:entities.class_other)', lookup)).toBe('শ্রেণি');
  expect(makeT('bn')('common.entities.class_other')).toBe('শ্রেণি');
});

test('nested in nested resolves', () => {
  const m: Record<string, string> = { 'a.x': 'A $t(a:y)', 'a.y': 'B $t(a:z)', 'a.z': 'C' };
  expect(resolveNesting('$t(a:x)!', (k) => m[k])).toBe('A B C!');
});

test('missing key, cycle and depth throw', () => {
  expect(() => resolveNesting('$t(a:nope)', () => undefined)).toThrow(/not found/);
  expect(() => resolveNesting('$t(a:x)', () => '$t(a:x)')).toThrow(/cycle/);
  expect(() => resolveNesting('$t(a:x)', (k) => `$t(a:${k}x)`)).toThrow(/deeper/);
});

test('a string without nesting is unchanged', () => {
  expect(resolveNesting('plain {{n}} text', () => undefined)).toBe('plain {{n}} text');
});

test('t() of a converted key is the stock text, in both locales', () => {
  expect(makeT('en')('trial.seatLimit.title')).toBe('Student limit reached');
  expect(makeT('bn')('billing.buy.seats')).toBe('সিট (শিক্ষার্থী)');
});
