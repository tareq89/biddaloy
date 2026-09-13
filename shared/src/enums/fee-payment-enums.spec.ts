import { describe, expect, it } from 'vitest';

import {
  ApprovalMode,
  ApprovalScope,
  DiscountKind,
  DuplicateStrategy,
  FeeGenerationSource,
  FeeType,
  InvoiceKind,
  PaymentAllocationType,
  PaymentMethod,
  PeriodType,
  RecurrenceKind,
  WalletTransactionKind,
} from './index';
import { AUDIT_ENTITY_TYPES } from '../audit/entity-types';

/**
 * Contract test for the Epic 16 rebuild's fee/payment enums (#638). This is
 * the only ticket in the epic that touches `shared/`, so every enum every
 * later Wave-1 task imports gets locked down here before those tasks start.
 */
describe('16.1.1 fee/payment enums [#638]', () => {
  it('PaymentMethod has exactly the 16.x method set, dropping UPI and ONLINE (D16)', () => {
    expect(Object.values(PaymentMethod).sort()).toEqual(
      ['CASH', 'CHEQUE', 'BANK_TRANSFER', 'CARD', 'BKASH', 'NAGAD', 'ROCKET'].sort(),
    );
    expect(PaymentMethod).not.toHaveProperty('UPI');
    expect(PaymentMethod).not.toHaveProperty('ONLINE');
  });

  it('PaymentAllocationType drops ADVANCE, keeping DUE and CURRENT (D5)', () => {
    expect(Object.values(PaymentAllocationType).sort()).toEqual(['DUE', 'CURRENT'].sort());
    expect(PaymentAllocationType).not.toHaveProperty('ADVANCE');
  });

  it('FeeType gains LATE_FEE (D11)', () => {
    expect(FeeType.LATE_FEE).toBe('LATE_FEE');
  });

  it('PeriodType has MONTH and WEEK', () => {
    expect(Object.values(PeriodType).sort()).toEqual(['MONTH', 'WEEK'].sort());
  });

  it('FeeGenerationSource has MANUAL and SCHEDULE', () => {
    expect(Object.values(FeeGenerationSource).sort()).toEqual(['MANUAL', 'SCHEDULE'].sort());
  });

  it('DuplicateStrategy has SKIP, REMOVE_OLDER, CREATE_ANYWAY', () => {
    expect(Object.values(DuplicateStrategy).sort()).toEqual(
      ['SKIP', 'REMOVE_OLDER', 'CREATE_ANYWAY'].sort(),
    );
  });

  it('DiscountKind has FLAT and PERCENT', () => {
    expect(Object.values(DiscountKind).sort()).toEqual(['FLAT', 'PERCENT'].sort());
  });

  it('WalletTransactionKind has the 5 wallet movement reasons', () => {
    expect(Object.values(WalletTransactionKind).sort()).toEqual(
      [
        'CREDIT_OVERPAYMENT',
        'CREDIT_CHANGE',
        'DEBIT_CHECKOUT',
        'DEBIT_GENERATION',
        'REVERSAL',
      ].sort(),
    );
  });

  it('InvoiceKind has INVOICE and CREDIT_NOTE', () => {
    expect(Object.values(InvoiceKind).sort()).toEqual(['INVOICE', 'CREDIT_NOTE'].sort());
  });

  it('ApprovalScope has the 5 gated-action scope strings', () => {
    expect(Object.values(ApprovalScope).sort()).toEqual(
      [
        'fees.duplicate_override',
        'fees.edit_paid',
        'fees.discount',
        'payments.reverse',
        'discount_rules.manage',
      ].sort(),
    );
  });

  it('ApprovalMode has OTP and OTP_OR_PASSWORD', () => {
    expect(Object.values(ApprovalMode).sort()).toEqual(['OTP', 'OTP_OR_PASSWORD'].sort());
  });

  it('RecurrenceKind has MONTHLY and WEEKLY', () => {
    expect(Object.values(RecurrenceKind).sort()).toEqual(['MONTHLY', 'WEEKLY'].sort());
  });

  it('AUDIT_ENTITY_TYPES contains the 6 new 16.x entity names, alphabetically placed', () => {
    const newNames = [
      'FeeGeneration',
      'StudentWallet',
      'DiscountRule',
      'RecurringSchedule',
      'InvoiceShareToken',
      'ApprovalToken',
    ];
    for (const name of newNames) {
      expect(AUDIT_ENTITY_TYPES).toContain(name);
    }
    expect([...AUDIT_ENTITY_TYPES]).toEqual([...AUDIT_ENTITY_TYPES].sort());
  });
});
