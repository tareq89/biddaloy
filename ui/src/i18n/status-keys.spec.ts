/**
 * [8.14.15] `check-i18n-keys.mjs` is regex-based and — by its own
 * README — cannot see a computed key like `` t(`status.${domain}.${status}`) ``
 * (`status-badge.tsx`'s `statusLabelKey`). Without this suite, a new enum
 * member could ship with no `en`/`bn` label and still pass CI green: the
 * static scanner would never flag the missing key, and the component
 * falls back to `humanizeStatus` silently rather than throwing. This test
 * is the only thing standing between "new enum member" and "raw English
 * fallback shown to a `bn` user forever".
 */
import {
  CommunicationStatus,
  EnrollmentStatus,
  FeeStatus,
  FeeType,
  InvoiceStatus,
  PaymentStatus,
  ReminderBatchStatus,
  TeacherDesignation,
  UserStatus,
} from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import bnCommon from './locales/bn/common.json';
import bnFeeStructures from './locales/bn/feeStructures.json';
import bnStaff from './locales/bn/staff.json';
import enCommon from './locales/en/common.json';
import enFeeStructures from './locales/en/feeStructures.json';
import enStaff from './locales/en/staff.json';

type LocaleValue = string | Record<string, unknown>;

function get(obj: Record<string, LocaleValue>, path: string[]): unknown {
  return path.reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

const STATUS_DOMAINS: Record<string, readonly string[]> = {
  fee: Object.values(FeeStatus),
  payment: Object.values(PaymentStatus),
  invoice: Object.values(InvoiceStatus),
  communication: Object.values(CommunicationStatus),
  reminderBatch: Object.values(ReminderBatchStatus),
  enrollment: Object.values(EnrollmentStatus),
  academicYear: ['CURRENT', 'NOT_CURRENT'],
  guardian: ['PRIMARY', 'SECONDARY'],
  feeStructure: ['RECURRING', 'ONE_TIME'],
  user: Object.values(UserStatus),
};

describe('status label key parity', () => {
  for (const [domain, members] of Object.entries(STATUS_DOMAINS)) {
    it.each(members)(`has an en and bn label for status.${domain}.%s`, (member) => {
      const enValue = get(enCommon, ['status', domain, member]);
      const bnValue = get(bnCommon, ['status', domain, member]);

      expect(typeof enValue).toBe('string');
      expect(enValue).not.toBe('');
      expect(typeof bnValue).toBe('string');
      expect(bnValue).not.toBe('');
    });
  }

  it.each(Object.values(FeeType))('has an en and bn label for feeTypes.%s', (member) => {
    const enValue = get(enFeeStructures, ['feeTypes', member]);
    const bnValue = get(bnFeeStructures, ['feeTypes', member]);

    expect(typeof enValue).toBe('string');
    expect(enValue).not.toBe('');
    expect(typeof bnValue).toBe('string');
    expect(bnValue).not.toBe('');
  });

  it.each(Object.values(TeacherDesignation))(
    'has an en and bn label for teacherForm.designations.%s',
    (member) => {
      const enValue = get(enStaff, ['teacherForm', 'designations', member]);
      const bnValue = get(bnStaff, ['teacherForm', 'designations', member]);

      expect(typeof enValue).toBe('string');
      expect(enValue).not.toBe('');
      expect(typeof bnValue).toBe('string');
      expect(bnValue).not.toBe('');
    },
  );
});
