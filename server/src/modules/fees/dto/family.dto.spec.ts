import { describe, it, expect } from 'vitest';
import {
  DiscountKind,
  FeeStatus,
  FeeType,
  InvoiceKind,
  InvoiceStatus,
  PaymentAllocationType,
  PaymentMethod,
  PaymentStatus,
  PeriodType,
  WalletTransactionKind,
} from '@biddaloy/shared';
import {
  occurrenceLabel,
  referenceLast4,
  ruleLabel,
  toFamilyDiscountRule,
  toFamilyFeeStructure,
  toFamilyInvoice,
  toFamilyPayment,
  toFamilyStudentDue,
  toFamilyStudentFee,
  toFamilyStudentSchedule,
  toFamilyWalletTransaction,
} from './family.dto';
import { Payment } from '../entities/payment.entity';
import { StudentFee } from '../entities/student-fee.entity';
import { FeeStructure } from '../entities/fee-structure.entity';
import { WalletTransaction } from '../entities/wallet-transaction.entity';
import { DiscountRule } from '../entities/discount-rule.entity';
import { RecurringSchedule } from '../entities/recurring-schedule.entity';
import { Invoice, InvoiceSnapshot } from '../../invoices/entities/invoice.entity';
import { IssuerSnapshot } from '../../schools/profile/issuer-snapshot';
import type { StudentDueSummary } from '../fee-dues.service';

/**
 * [16.8.2] The contract this file enforces is *key equality*, not "some
 * fields are missing".
 *
 * A `not.toHaveProperty('secret')` test only catches the leak someone
 * already thought of. `expect(Object.keys(dto).sort()).toEqual(ALLOW_LIST)`
 * catches the one nobody thought of: add a column to `Payment`, wire it into
 * the mapper by reflex, and this file goes red before the field ever reaches
 * a guardian's browser.
 *
 * Each ALLOW_LIST below is the published family contract. Changing one is a
 * deliberate act that shows up in review as a diff on this file.
 */

function expectKeys(actual: object, allowList: string[]): void {
  expect(Object.keys(actual).sort()).toEqual([...allowList].sort());
}

// ---------------------------------------------------------------------------

describe('referenceLast4', () => {
  it('keeps only the last 4 characters of a payment reference', () => {
    expect(referenceLast4('TRX-9988776655')).toBe('6655');
  });

  it('returns null for a missing reference rather than an empty string', () => {
    expect(referenceLast4(null)).toBeNull();
    expect(referenceLast4(undefined)).toBeNull();
    expect(referenceLast4('')).toBeNull();
  });

  it('does not pad a reference that is already shorter than 4 characters', () => {
    expect(referenceLast4('12')).toBe('12');
  });
});

describe('occurrenceLabel', () => {
  it('is null for the ordinary one-bill-per-period case', () => {
    expect(occurrenceLabel(1)).toBeNull();
    expect(occurrenceLabel(0)).toBeNull();
    expect(occurrenceLabel(null)).toBeNull();
  });

  it('labels a repeat bill in the same period', () => {
    expect(occurrenceLabel(2)).toBe('#2');
  });
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

const PAYMENT_KEYS = [
  'id',
  'student_id',
  'total_amount',
  'payment_method',
  'payment_status',
  'transaction_reference',
  'invoice_id',
  'invoice_number',
  'is_reversal',
  'payment_date',
  'created_at',
  'allocations',
];

const ALLOCATION_KEYS = [
  'id',
  'student_fee_id',
  'allocated_amount',
  'discount_amount',
  'allocation_type',
  'fee_name',
  'period_start',
];

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    student_id: 'student-1',
    tenant_id: 'tenant-1',
    total_amount: 1000,
    payment_method: PaymentMethod.CASH,
    payment_status: PaymentStatus.COMPLETED,
    transaction_reference: 'TRX-9988776655',
    invoice_id: 'inv-1',
    invoice: { invoice_number: 'INV-2026-00042' },
    payment_date: new Date('2026-01-15'),
    created_at: new Date('2026-01-15'),
    updated_at: new Date('2026-01-15'),
    deleted_at: null,
    // Every one of these must stay out of the family response.
    remarks: 'Parent argued about the late fee',
    received_by_user_id: 'staff-1',
    received_by: { id: 'staff-1', full_name: 'Cashier Karim' },
    approved_by_user_id: 'admin-1',
    reversal_reason: 'duplicate entry',
    reversal_of_payment_id: null,
    reversed_by_payment_id: null,
    idempotency_key: 'idem-123',
    tendered_amount: 1000,
    change_amount: 0,
    wallet_credit_used: 0,
    wallet_credit_added: 0,
    issuer_snapshot: null,
    allocations: [
      {
        id: 'alloc-1',
        payment_id: 'pay-1',
        student_fee_id: 'fee-1',
        allocated_amount: 1000,
        discount_amount: 50,
        allocation_type: PaymentAllocationType.FEE,
        notes: 'internal note about this allocation',
        created_at: new Date('2026-01-15'),
        student_fee: {
          period_start: new Date('2026-01-01'),
          fee_structure: { name: 'Tuition Fee' },
        },
      },
    ],
    ...overrides,
  } as unknown as Payment;
}

describe('toFamilyPayment', () => {
  it('publishes exactly the family allow-list and nothing else', () => {
    const dto = toFamilyPayment(makePayment());
    expectKeys(dto, PAYMENT_KEYS);
    expectKeys(dto.allocations![0], ALLOCATION_KEYS);
  });

  it('withholds staff-only columns even though they are present on the entity', () => {
    const json = JSON.stringify(toFamilyPayment(makePayment()));

    expect(json).not.toContain('Parent argued about the late fee');
    expect(json).not.toContain('staff-1');
    expect(json).not.toContain('admin-1');
    expect(json).not.toContain('duplicate entry');
    expect(json).not.toContain('idem-123');
    expect(json).not.toContain('internal note about this allocation');
  });

  it('joins the invoice number and flags a reversal', () => {
    const plain = toFamilyPayment(makePayment());
    expect(plain.invoice_number).toBe('INV-2026-00042');
    expect(plain.is_reversal).toBe(false);

    const reversal = toFamilyPayment(makePayment({ reversal_of_payment_id: 'pay-0' } as never));
    expect(reversal.is_reversal).toBe(true);
    // The fact of the reversal is published; the internal reason is not.
    expect(reversal).not.toHaveProperty('reversal_reason');
  });

  it('degrades to nulls rather than crashing when relations were not loaded', () => {
    const dto = toFamilyPayment(
      makePayment({
        invoice: null,
        allocations: [
          {
            id: 'alloc-1',
            student_fee_id: 'fee-1',
            allocated_amount: 1000,
            discount_amount: 0,
            allocation_type: PaymentAllocationType.FEE,
          },
        ],
      } as never),
    );

    expect(dto.invoice_number).toBeNull();
    expect(dto.allocations![0].fee_name).toBeNull();
    expect(dto.allocations![0].period_start).toBeNull();
    expectKeys(dto.allocations![0], ALLOCATION_KEYS);
  });

  it('omits allocations entirely when the relation was not loaded at all', () => {
    const dto = toFamilyPayment(makePayment({ allocations: undefined } as never));
    expectKeys(
      dto,
      PAYMENT_KEYS.filter((k) => k !== 'allocations'),
    );
  });
});

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

const BILL_KEYS = [
  'id',
  'student_id',
  'academic_year_id',
  'fee_name',
  'fee_type',
  'month',
  'year',
  'period_start',
  'period_type',
  'occurrence_label',
  'is_late_fee',
  'total_amount',
  'paid_amount',
  'discount_amount',
  'balance',
  'status',
  'due_date',
];

function makeStudentFee(overrides: Partial<StudentFee> = {}): StudentFee {
  return {
    id: 'fee-1',
    student_id: 'student-1',
    academic_year_id: 'ay-1',
    fee_structure_id: 'fs-1',
    fee_structure: { name: 'Tuition Fee', fee_type: FeeType.MONTHLY_TUITION },
    fee_generation_id: 'gen-1',
    period_start: new Date('2026-03-01'),
    period_type: PeriodType.MONTH,
    occurrence: 2,
    month: 3,
    year: 2026,
    total_amount: 1000,
    paid_amount: 200,
    discount_amount: 100,
    standing_discount_amount: 100,
    one_off_discount_amount: 0,
    status: FeeStatus.PARTIAL,
    due_date: null,
    reminder_threshold_date: new Date('2026-03-10'),
    approved_by_user_id: 'user-1',
    late_fee_for_student_fee_id: null,
    ...overrides,
  } as unknown as StudentFee;
}

describe('toFamilyStudentFee', () => {
  it('publishes exactly the family allow-list and nothing else', () => {
    expectKeys(toFamilyStudentFee(makeStudentFee()), BILL_KEYS);
  });

  it('withholds the internal bill-generation and dunning bookkeeping', () => {
    const dto = toFamilyStudentFee(makeStudentFee());

    // `occurrence` itself stays internal — only its human label ships.
    expect(dto).not.toHaveProperty('occurrence');
    expect(dto).not.toHaveProperty('approved_by_user_id');
    expect(dto).not.toHaveProperty('fee_generation_id');
    expect(dto).not.toHaveProperty('reminder_threshold_date');
    // The standing/one-off discount split is the school's own bookkeeping.
    expect(dto).not.toHaveProperty('standing_discount_amount');
    expect(dto).not.toHaveProperty('one_off_discount_amount');
  });

  it('computes balance as total - discount - paid', () => {
    expect(toFamilyStudentFee(makeStudentFee()).balance).toBe(700);
  });

  it('normalizes numeric-as-string columns before doing the arithmetic', () => {
    // The pg driver hands back `numeric` columns as strings; without the
    // Number() coercion in the mapper this produced '1000-100-200' style
    // string concatenation rather than a number.
    const dto = toFamilyStudentFee(
      makeStudentFee({ total_amount: '1000', discount_amount: '100', paid_amount: '200' } as never),
    );
    expect(dto.balance).toBe(700);
  });

  it('flags a late-fee bill without naming the bill it punishes', () => {
    const dto = toFamilyStudentFee(
      makeStudentFee({ late_fee_for_student_fee_id: 'fee-0' } as never),
    );
    expect(dto.is_late_fee).toBe(true);
    expect(dto).not.toHaveProperty('late_fee_for_student_fee_id');
  });

  it('labels a repeat occurrence and leaves the ordinary case unlabelled', () => {
    expect(toFamilyStudentFee(makeStudentFee()).occurrence_label).toBe('#2');
    expect(
      toFamilyStudentFee(makeStudentFee({ occurrence: 1 } as never)).occurrence_label,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dues
// ---------------------------------------------------------------------------

const DUE_ENTRY_KEYS = [
  'student_fee_id',
  'fee_name',
  'fee_type',
  'month',
  'year',
  'period_start',
  'period_type',
  'occurrence_label',
  'is_late_fee',
  'total_amount',
  'paid_amount',
  'discount_amount',
  'balance',
  'status',
  'due_date',
];

const STUDENT_DUE_KEYS = [
  'student_id',
  'full_name',
  'registration_number',
  'roll_number',
  'class_name',
  'section_name',
  'total_due',
  'months_overdue',
  'dues',
];

function makeStudentDueSummary(): StudentDueSummary {
  return {
    student_id: 'student-1',
    full_name: 'Jane Doe',
    registration_number: 'REG-1',
    roll_number: 7,
    class_name: 'Class 5',
    section_name: 'A',
    total_due: 700,
    months_overdue: 1,
    dues: [
      {
        student_fee_id: 'fee-1',
        fee_structure_id: 'fs-1',
        fee_name: 'Tuition Fee',
        fee_type: FeeType.MONTHLY_TUITION,
        month: 3,
        year: 2026,
        period_start: new Date('2026-03-01'),
        period_type: PeriodType.MONTH,
        occurrence: 1,
        is_late_fee: false,
        total_amount: 1000,
        paid_amount: 200,
        discount_amount: 100,
        standing_discount_amount: 100,
        one_off_discount_amount: 0,
        balance: 700,
        status: FeeStatus.PARTIAL,
        due_date: null,
        reminder_threshold_date: new Date('2026-03-10'),
      },
    ],
  } as unknown as StudentDueSummary;
}

describe('toFamilyStudentDue', () => {
  it('publishes exactly the family allow-list, at both levels', () => {
    const dto = toFamilyStudentDue(makeStudentDueSummary());
    expectKeys(dto, STUDENT_DUE_KEYS);
    expectKeys(dto.dues[0], DUE_ENTRY_KEYS);
  });

  it('withholds reminder_threshold_date, fee_structure_id and the discount split', () => {
    const due = toFamilyStudentDue(makeStudentDueSummary()).dues[0];

    expect(due).not.toHaveProperty('reminder_threshold_date');
    expect(due).not.toHaveProperty('fee_structure_id');
    expect(due).not.toHaveProperty('occurrence');
    expect(due).not.toHaveProperty('standing_discount_amount');
    expect(due).not.toHaveProperty('one_off_discount_amount');
  });
});

// ---------------------------------------------------------------------------
// Fee structures
// ---------------------------------------------------------------------------

describe('toFamilyFeeStructure', () => {
  it('publishes exactly the family allow-list and drops the student roster', () => {
    const structure = {
      id: 'fs-1',
      fee_type: FeeType.MONTHLY_TUITION,
      name: 'Tuition Fee',
      amount: 1000,
      class_id: 'class-1',
      section_id: null,
      academic_year_id: 'ay-1',
      tenant_id: 'tenant-1',
      // `findOne` eager-loads this for the staff edit dialog; it carries
      // other families' children in full.
      selected_students: [
        { student: { id: 'other-student', full_name: 'Someone Else', home_address: '9 Elm St' } },
      ],
    } as unknown as FeeStructure;

    const dto = toFamilyFeeStructure(structure);

    expectKeys(dto, [
      'id',
      'fee_type',
      'name',
      'amount',
      'class_id',
      'section_id',
      'academic_year_id',
    ]);
    expect(JSON.stringify(dto)).not.toContain('Someone Else');
    expect(JSON.stringify(dto)).not.toContain('9 Elm St');
  });
});

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

describe('toFamilyWalletTransaction', () => {
  it('publishes exactly amount, kind and created_at', () => {
    const tx = {
      id: 'tx-1',
      wallet_id: 'wallet-1',
      tenant_id: 'tenant-1',
      amount: '250.00',
      kind: WalletTransactionKind.CREDIT,
      note: 'Refunded after the office miscounted the cash',
      payment_id: 'pay-1',
      student_fee_id: 'fee-1',
      reversal_of_id: null,
      created_by_user_id: 'staff-1',
      created_at: new Date('2026-01-15'),
    } as unknown as WalletTransaction;

    const dto = toFamilyWalletTransaction(tx);

    expectKeys(dto, ['amount', 'kind', 'created_at']);
    // [16.8.2] `note` is staff free text of the same kind as
    // `Payment.remarks` and used to be handed to families verbatim.
    expect(dto).not.toHaveProperty('note');
    expect(JSON.stringify(dto)).not.toContain('miscounted');
    expect(JSON.stringify(dto)).not.toContain('staff-1');
  });

  it('normalizes the pg numeric-as-string amount to a number', () => {
    const dto = toFamilyWalletTransaction({
      amount: '250.00',
      kind: WalletTransactionKind.CREDIT,
      created_at: new Date('2026-01-15'),
    } as unknown as WalletTransaction);

    expect(dto.amount).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

const INVOICE_KEYS = [
  'id',
  'invoice_number',
  'kind',
  'student_id',
  'payment_id',
  'related_invoice_id',
  'total_amount',
  'tax_amount',
  'discount_amount',
  'status',
  'issued_date',
  'due_date',
  'snapshot',
  'issued_by',
  'created_at',
  'updated_at',
  'issuer',
];

function makeSnapshot(): InvoiceSnapshot {
  return {
    issuer: {
      name: 'Green Valley School',
      name_bn: 'গ্রিন ভ্যালি স্কুল',
      address: '123 Main Rd',
      phone: '+8801700000000',
      email: 'admin@greenvalley.example',
      registration_id: 'EIIN-123456',
      logo_key: 'logos/green-valley.png',
      captured_at: '2026-01-15T10:00:00.000Z',
    } as IssuerSnapshot,
    students: [
      {
        id: 'student-1',
        full_name: 'Jane Doe',
        registration_number: 'REG-1',
        class_name: 'Class 5',
        lines: [
          {
            fee_name: 'Tuition',
            period_label: 'January 2026',
            amount: 1000,
            discount: 0,
            paid_this_time: 1000,
            balance_after: 0,
          },
        ],
      },
    ],
    totals: { billed: 1000, discount: 0, paid: 1000, change: 0, wallet_used: 0, wallet_added: 0 },
    payment: {
      method: PaymentMethod.CASH,
      reference: 'TRX-9988776655',
      received_by_name: 'Cashier Karim',
      payment_date: '2026-01-15',
    },
  };
}

function makeInvoice(): Invoice & { issuer?: IssuerSnapshot } {
  const snapshot = makeSnapshot();
  return {
    id: 'inv-1',
    invoice_number: 'INV-2026-00001',
    kind: InvoiceKind.INVOICE,
    student_id: 'student-1',
    payment_id: 'payment-1',
    related_invoice_id: null,
    total_amount: 1000,
    tax_amount: 0,
    discount_amount: 0,
    status: InvoiceStatus.ISSUED,
    issued_date: new Date('2026-01-15'),
    due_date: new Date('2026-01-25'),
    snapshot,
    issuer_snapshot: snapshot.issuer,
    notes: 'Family disputed this invoice; escalate to the principal',
    issued_by_user_id: 'user-1',
    created_at: new Date('2026-01-15'),
    updated_at: new Date('2026-01-15'),
    deleted_at: null,
    issuer: snapshot.issuer,
  } as unknown as Invoice & { issuer?: IssuerSnapshot };
}

describe('toFamilyInvoice', () => {
  it('publishes exactly the family allow-list and nothing else', () => {
    expectKeys(toFamilyInvoice(makeInvoice()), INVOICE_KEYS);
  });

  it('[16.8.2] withholds the invoice notes field', () => {
    const family = toFamilyInvoice(makeInvoice());

    // `Invoice.notes` is the same category as `Payment.remarks` — internal
    // staff free text. It was being returned to family callers verbatim.
    expect(family).not.toHaveProperty('notes');
    expect(JSON.stringify(family)).not.toContain('escalate to the principal');
  });

  it('[16.8.2] cuts the payment reference down to its last 4 characters', () => {
    const family = toFamilyInvoice(makeInvoice());

    expect(family.snapshot.payment.reference).toBe('6655');
    expect(JSON.stringify(family)).not.toContain('TRX-9988776655');
  });

  it('withholds received_by_name from the snapshot payment block', () => {
    const family = toFamilyInvoice(makeInvoice());

    expect(family.snapshot.payment.received_by_name).toBeNull();
    expect(family.snapshot.payment.method).toBe(PaymentMethod.CASH);
    expect(family.snapshot.payment.payment_date).toBe('2026-01-15');
  });

  it('reduces the snapshot issuer to public identity fields only', () => {
    const family = toFamilyInvoice(makeInvoice());

    expect(family.snapshot.issuer.name).toBe('Green Valley School');
    expect(family.snapshot.issuer.name_bn).toBe('গ্রিন ভ্যালি স্কুল');
    expect(family.snapshot.issuer.address).toBe('123 Main Rd');
    expect(family.snapshot.issuer.logo_key).toBe('logos/green-valley.png');
    expect(family.snapshot.issuer.phone).toBeNull();
    expect(family.snapshot.issuer.email).toBeNull();
    expect(family.snapshot.issuer.registration_id).toBeNull();
  });

  it('also redacts the top-level issuer field', () => {
    const family = toFamilyInvoice(makeInvoice());

    expect(family.issuer?.phone).toBeNull();
    expect(family.issuer?.email).toBeNull();
    expect(family.issuer?.registration_id).toBeNull();
    expect(family.issuer?.name).toBe('Green Valley School');
  });

  it('never serializes phone/email/registration_id/staff name anywhere in the response', () => {
    const json = JSON.stringify(toFamilyInvoice(makeInvoice()));

    expect(json).not.toContain('+8801700000000');
    expect(json).not.toContain('admin@greenvalley.example');
    expect(json).not.toContain('EIIN-123456');
    expect(json).not.toContain('Cashier Karim');
    expect(json).not.toContain('user-1');
  });

  it('omits the optional issuer key entirely when the caller did not load it', () => {
    const invoice = makeInvoice();
    delete (invoice as { issuer?: IssuerSnapshot }).issuer;

    expectKeys(
      toFamilyInvoice(invoice),
      INVOICE_KEYS.filter((k) => k !== 'issuer'),
    );
  });
});

// ---------------------------------------------------------------------------
// Discount rules
// ---------------------------------------------------------------------------

describe('toFamilyDiscountRule', () => {
  it('publishes the money and the window, never who granted it or why', () => {
    const rule = {
      id: 'rule-1',
      tenant_id: 'tenant-1',
      student_id: 'student-1',
      kind: DiscountKind.PERCENT,
      value: '10.00',
      fee_types: [FeeType.MONTHLY_TUITION],
      starts_on: '2026-01-01',
      ends_on: null,
      reason: "Principal's discretion — do not repeat next year",
      created_by_user_id: 'staff-1',
      approved_by_user_id: 'admin-1',
      is_active: true,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
    } as unknown as DiscountRule;

    const dto = toFamilyDiscountRule(rule);

    expectKeys(dto, [
      'id',
      'student_id',
      'kind',
      'value',
      'fee_types',
      'starts_on',
      'ends_on',
      'is_active',
    ]);
    // [16.8.2] The staff DTO used to be returned to family callers verbatim.
    expect(dto).not.toHaveProperty('reason');
    expect(dto).not.toHaveProperty('created_by_user_id');
    expect(dto).not.toHaveProperty('approved_by_user_id');
    const json = JSON.stringify(dto);
    expect(json).not.toContain('Principal');
    expect(json).not.toContain('staff-1');
    expect(json).not.toContain('admin-1');
  });

  it('normalizes the pg numeric-as-string value to a number', () => {
    const dto = toFamilyDiscountRule({
      value: '10.00',
      fee_types: null,
      starts_on: null,
      ends_on: null,
      is_active: true,
    } as unknown as DiscountRule);

    expect(dto.value).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Recurring schedules
// ---------------------------------------------------------------------------

describe('ruleLabel', () => {
  it('reads a monthly rule as a sentence', () => {
    expect(ruleLabel({ kind: 'MONTHLY', day_of_month: 5 })).toBe('Monthly on day 5');
    expect(ruleLabel({ kind: 'MONTHLY', day_of_month: 'LAST' })).toBe('Monthly on the last day');
  });

  it('reads a weekly rule as named days, in week order', () => {
    expect(ruleLabel({ kind: 'WEEKLY', weekdays: [7, 2] })).toBe('Weekly on Tue, Sun');
  });
});

describe('toFamilyStudentSchedule', () => {
  it('publishes exactly name, fees, rule_label and next_period', () => {
    const schedule = {
      id: 'sched-1',
      tenant_id: 'tenant-1',
      academic_year_id: 'ay-1',
      name: 'Monthly tuition',
      audience: { class_id: 'class-9', enrollment_status: 'ACTIVE' },
      rule: { kind: 'MONTHLY', day_of_month: 5 },
      period_type: PeriodType.MONTH,
      due_days_after_period_start: 9,
      starts_on: '2026-01-01',
      ends_on: '2026-12-31',
      notify_families: true,
      is_active: true,
      last_run_period: '2026-02-01',
      created_by_user_id: 'staff-1',
    } as unknown as RecurringSchedule;

    const dto = toFamilyStudentSchedule({
      schedule,
      fees: [{ name: 'Tuition Fee', amount: 1000 }],
      next_period: '2026-03-01',
    });

    expectKeys(dto, ['name', 'fees', 'rule_label', 'next_period']);
    expectKeys(dto.fees[0], ['name', 'amount']);
    expect(dto.rule_label).toBe('Monthly on day 5');
    expect(dto.next_period).toBe('2026-03-01');

    // The billing-automation config stays server-side: a guardian sees no
    // schedule id, no audience, no activity/exclusion state, and no record
    // of which staff member set it up.
    const json = JSON.stringify(dto);
    expect(json).not.toContain('sched-1');
    expect(json).not.toContain('class-9');
    expect(json).not.toContain('staff-1');
    expect(json).not.toContain('last_run_period');
    expect(dto).not.toHaveProperty('excluded');
    expect(dto).not.toHaveProperty('is_active');
  });
});
