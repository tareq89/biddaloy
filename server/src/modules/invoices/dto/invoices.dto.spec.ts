import { describe, it, expect } from 'vitest';
import { InvoiceKind, InvoiceStatus, PaymentMethod } from '@biddaloy/shared';
import { toFamilyInvoice } from './invoices.dto';
import { Invoice, InvoiceSnapshot } from '../entities/invoice.entity';
import { IssuerSnapshot } from '../../schools/profile/issuer-snapshot';

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
      reference: 'REF-1',
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
    notes: null,
    issued_by_user_id: 'user-1',
    created_at: new Date('2026-01-15'),
    updated_at: new Date('2026-01-15'),
    deleted_at: null,
    issuer: snapshot.issuer,
  } as unknown as Invoice & { issuer?: IssuerSnapshot };
}

describe('toFamilyInvoice', () => {
  it('withholds received_by_name from the snapshot payment block', () => {
    const family = toFamilyInvoice(makeInvoice());

    expect(family.snapshot.payment.received_by_name).toBeNull();
    expect(family.snapshot.payment.method).toBe(PaymentMethod.CASH);
    expect(family.snapshot.payment.reference).toBe('REF-1');
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

  it('never serializes phone/email/registration_id anywhere in the response', () => {
    const family = toFamilyInvoice(makeInvoice());
    const json = JSON.stringify(family);

    expect(json).not.toContain('+8801700000000');
    expect(json).not.toContain('admin@greenvalley.example');
    expect(json).not.toContain('EIIN-123456');
    expect(json).not.toContain('Cashier Karim');
  });
});
