import { InvoiceKind, InvoiceStatus, PaymentMethod } from '@biddaloy/shared';

import type { components } from '../../api/schema';

import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { moneyAmount } from './money';
import type { Script } from './script';
import { studentFactory } from './student.factory';

export type Invoice = components['schemas']['Invoice'];

// [16.5.1] `snapshot` is the whole frozen document — see
// `InvoiceSnapshot` server-side. Nothing in `ui/` currently reads into
// it directly (printing/rendering is server-side HTML), so a minimal but
// shape-complete default is enough for tests that don't override it.
function defaultSnapshot(student: components['schemas']['Student'], amount: number) {
  return {
    issuer: {
      name: 'Test School',
      name_bn: null,
      address: null,
      phone: null,
      email: null,
      registration_id: null,
      logo_key: null,
      captured_at: FACTORY_REFERENCE_DATE.toISOString(),
    },
    students: [
      {
        id: student.id,
        full_name: student.full_name,
        registration_number: student.registration_number,
        class_name: null,
        lines: [],
      },
    ],
    totals: {
      billed: amount,
      discount: 0,
      paid: amount,
      change: 0,
      wallet_used: 0,
      wallet_added: 0,
    },
    payment: {
      method: PaymentMethod.CASH,
      reference: null,
      received_by_name: null,
      payment_date: FACTORY_REFERENCE_DATE.toISOString(),
    },
  };
}

// Default `payment: null` — see payment.factory.ts's comment on
// `invoice: null`; same reasoning, the other direction.
export function invoiceFactory(overrides: Partial<Invoice> = {}, script?: Script): Invoice {
  const student = overrides.student ?? studentFactory({}, script);
  const issuedDate = faker.date.recent({ refDate: FACTORY_REFERENCE_DATE });
  const totalAmount = overrides.total_amount ?? moneyAmount(4);
  return {
    id: faker.string.uuid(),
    invoice_number: `INV-${faker.string.numeric(8)}`,
    kind: InvoiceKind.INVOICE,
    snapshot: defaultSnapshot(student, totalAmount),
    student,
    student_id: student.id,
    payment: null,
    payment_id: null,
    related_invoice: null,
    related_invoice_id: null,
    total_amount: totalAmount,
    tax_amount: 0,
    discount_amount: 0,
    status: InvoiceStatus.ISSUED,
    issued_date: issuedDate.toISOString(),
    due_date: faker.date.soon({ refDate: issuedDate }).toISOString(),
    issued_by: null,
    issued_by_user_id: null,
    issuer_snapshot: null,
    notes: null,
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
