import { PaymentMethod, PaymentStatus } from '@beton-boi/shared';

import type { components } from '../../api/schema';

import { FACTORY_REFERENCE_DATE, faker } from './faker';
import { moneyAmount } from './money';
import { schoolFactory } from './school.factory';
import type { Script } from './script';
import { studentFactory } from './student.factory';

export type Payment = components['schemas']['Payment'];

// Default `invoice: null` — Payment.invoice and Invoice's own payment
// references would otherwise recurse into each other; link a real invoice
// in via overrides when a test needs both sides.
export function paymentFactory(overrides: Partial<Payment> = {}, script?: Script): Payment {
  const student = overrides.student ?? studentFactory({}, script);
  const tenant = overrides.tenant ?? student.tenant ?? schoolFactory();
  return {
    id: faker.string.uuid(),
    student,
    student_id: student.id,
    total_amount: moneyAmount(4),
    payment_method: PaymentMethod.CASH,
    payment_status: PaymentStatus.SUCCESS,
    transaction_reference: null,
    remarks: null,
    received_by: null,
    received_by_user_id: null,
    invoice: null,
    invoice_id: null,
    allocations: [],
    payment_date: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    tenant,
    tenant_id: tenant.id,
    created_at: faker.date.past({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    updated_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}
