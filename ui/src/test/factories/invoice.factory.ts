import { InvoiceStatus } from '@biddaloy/shared';

import type { components } from '../../api/schema';

import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { moneyAmount } from './money';
import type { Script } from './script';
import { studentFactory } from './student.factory';

export type Invoice = components['schemas']['Invoice'];

// Default `student_fee: null` — see payment.factory.ts's comment on
// `invoice: null`; same reasoning, the other direction.
export function invoiceFactory(overrides: Partial<Invoice> = {}, script?: Script): Invoice {
  const student = overrides.student ?? studentFactory({}, script);
  const issuedDate = faker.date.recent({ refDate: FACTORY_REFERENCE_DATE });
  return {
    id: faker.string.uuid(),
    invoice_number: `INV-${faker.string.numeric(8)}`,
    student,
    student_id: student.id,
    student_fee: null,
    student_fee_id: null,
    total_amount: moneyAmount(4),
    tax_amount: 0,
    discount_amount: 0,
    status: InvoiceStatus.ISSUED,
    issued_date: issuedDate.toISOString(),
    due_date: faker.date.soon({ refDate: issuedDate }).toISOString(),
    line_items: null,
    issued_by: null,
    issued_by_user_id: null,
    notes: null,
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
