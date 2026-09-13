import { describe, it, expect } from 'vitest';
import {
  buildFeeNotificationMessage,
  formatFeeNotificationAmount,
  formatFeeNotificationDueDate,
  resolveFeeNotificationLocale,
} from './fee-notification-template.util';

describe('formatFeeNotificationAmount', () => {
  it('formats a whole number with thousands grouping, no decimals, in Latin digits', () => {
    expect(formatFeeNotificationAmount('en', 4200)).toBe('4,200');
  });

  it('formats a whole number in Bengali numerals for bn', () => {
    expect(formatFeeNotificationAmount('bn', 4200)).toBe('৪,২০০');
  });

  it('keeps two decimals when the amount has a fractional part', () => {
    expect(formatFeeNotificationAmount('en', 800.5)).toBe('800.50');
    expect(formatFeeNotificationAmount('bn', 800.5)).toBe('৮০০.৫০');
  });
});

describe('formatFeeNotificationDueDate', () => {
  it('renders day + English month name, no year', () => {
    expect(formatFeeNotificationDueDate('en', '2026-09-10')).toBe('10 September');
  });

  it('renders day + Bengali month name in Bengali numerals', () => {
    expect(formatFeeNotificationDueDate('bn', '2026-09-10')).toBe('১০ সেপ্টেম্বর');
  });

  it('accepts a Date object identically to an ISO string', () => {
    expect(formatFeeNotificationDueDate('en', new Date('2026-01-05T00:00:00Z'))).toBe(
      '5 January',
    );
  });
});

describe('buildFeeNotificationMessage', () => {
  it('matches the ticket wording for bn', () => {
    const message = buildFeeNotificationMessage(
      'bn',
      [
        { name: 'মাসিক ফি', amount: 4200 },
        { name: 'পরীক্ষা ফি', amount: 800 },
      ],
      '2026-09-10',
    );
    expect(message).toBe('নতুন ফি যোগ হয়েছে: মাসিক ফি ৪,২০০, পরীক্ষা ফি ৮০০ — শেষ তারিখ ১০ সেপ্টেম্বর');
  });

  it('matches the analogous en wording', () => {
    const message = buildFeeNotificationMessage(
      'en',
      [
        { name: 'Monthly Fee', amount: 4200 },
        { name: 'Exam Fee', amount: 800 },
      ],
      '2026-09-10',
    );
    expect(message).toBe('New fees added: Monthly Fee 4,200, Exam Fee 800 — Due date 10 September');
  });

  it('lists a single bill without a trailing comma', () => {
    const message = buildFeeNotificationMessage('en', [{ name: 'Monthly Fee', amount: 4200 }], '2026-09-10');
    expect(message).toBe('New fees added: Monthly Fee 4,200 — Due date 10 September');
  });

  it('does not translate the fee structure name itself', () => {
    // A school's own fee name is copied verbatim regardless of locale —
    // this util only translates the surrounding phrase and the numerals.
    const message = buildFeeNotificationMessage('bn', [{ name: 'Custom English Name', amount: 100 }], '2026-01-01');
    expect(message).toContain('Custom English Name');
  });
});

describe('resolveFeeNotificationLocale', () => {
  it('resolves a bn-* region locale to bn', () => {
    expect(resolveFeeNotificationLocale('bn-BD')).toBe('bn');
  });

  it('falls back to en for anything else, including undefined/null', () => {
    expect(resolveFeeNotificationLocale('en-US')).toBe('en');
    expect(resolveFeeNotificationLocale(undefined)).toBe('en');
    expect(resolveFeeNotificationLocale(null)).toBe('en');
  });
});
