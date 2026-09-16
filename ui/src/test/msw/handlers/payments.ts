import { http, HttpResponse } from 'msw';

import {
  paymentFactory,
  studentFactory,
  studentFeeFactory,
  type Payment,
  type StudentFee,
} from '../../factories';
import { paginate } from '../support';

const fixtures: Payment[] = [paymentFactory(), paymentFactory(), paymentFactory()];

const list = http.get('/api/v1/payments', ({ request }) =>
  HttpResponse.json(paginate(fixtures, request.url)),
);

const listEmpty = http.get('/api/v1/payments', ({ request }) =>
  HttpResponse.json(paginate([], request.url)),
);

const record = http.post('/api/v1/payments', () =>
  HttpResponse.json(paymentFactory(), { status: 201 }),
);

const recordWithAllocation = http.post('/api/v1/payments/record-with-allocation', () =>
  HttpResponse.json(paymentFactory(), { status: 201 }),
);

const listByStudent = http.get('/api/v1/payments/student/:studentId', ({ params }) =>
  HttpResponse.json(
    [paymentFactory(), paymentFactory()].map((payment): Payment => ({
      ...payment,
      student: { ...payment.student, id: params.studentId as string },
    })),
  ),
);

const listByStudentEmpty = http.get('/api/v1/payments/student/:studentId', () =>
  HttpResponse.json([]),
);

/** [8.11.4]'s Payment History tab. */
const listByGuardian = http.get('/api/v1/payments/guardian/:guardianId', () =>
  HttpResponse.json([paymentFactory(), paymentFactory()]),
);

const listByGuardianEmpty = http.get('/api/v1/payments/guardian/:guardianId', () =>
  HttpResponse.json([]),
);

/** `FeesController.getInvoiceSummary`'s actual shape — a fee/payment/
 * balance summary, not a bare invoice list the endpoint's own path
 * segment ("invoices/student") might suggest. See `payments.ts`'s
 * `StudentFeeSummary` (`ui/src/hooks`) for the hand-typed counterpart
 * this mirrors, since the controller never attached an `@ApiResponse`
 * type either. */
const listInvoicesByStudent = http.get(
  '/api/v1/payments/invoices/student/:studentId',
  ({ params }) => {
    const student = studentFactory({ id: params.studentId as string });
    const fees: StudentFee[] = [
      studentFeeFactory({ student, paid_amount: 0 }),
      studentFeeFactory({ student, paid_amount: 500, status: 'PARTIALLY_PAID' }),
    ];
    const totalDue = fees.reduce((sum, fee) => sum + fee.total_amount, 0);
    const totalPaid = fees.reduce((sum, fee) => sum + fee.paid_amount, 0);
    return HttpResponse.json({
      student_id: student.id,
      student_name: student.full_name,
      summary: {
        total_due: totalDue,
        total_paid: totalPaid,
        total_discount: 0,
        balance: totalDue - totalPaid,
      },
      fee_breakdown: fees,
      payments: [paymentFactory({ student })],
    });
  },
);

/** [16.6.2] `GET /payments/:id` — the detail route's fixture. Built off
 * `paymentFactory()` rather than a separate `paymentDetailFactory` since
 * `PaymentDetailDto` (`server/src/modules/fees/payments-query.service.ts`'s
 * `toDetailDto`) is just a narrower projection of the same `Payment` row
 * plus an `allocations` array the list/checkout factory doesn't need. */
function paymentDetailFactory(overrides: Partial<Payment> = {}) {
  const payment = paymentFactory(overrides);
  return {
    id: payment.id,
    student_id: payment.student_id,
    student: { id: payment.student.id, full_name: payment.student.full_name },
    total_amount: payment.total_amount,
    payment_method: payment.payment_method,
    payment_status: payment.payment_status,
    transaction_reference: payment.transaction_reference,
    payment_date: payment.payment_date,
    remarks: payment.remarks,
    invoice: payment.invoice
      ? {
          id: payment.invoice.id,
          invoice_number: payment.invoice.invoice_number,
          status: payment.invoice.status,
        }
      : null,
    received_by: payment.received_by
      ? { id: payment.received_by.id, full_name: payment.received_by.full_name }
      : null,
    approved_by: payment.approved_by
      ? { id: payment.approved_by.id, full_name: payment.approved_by.full_name }
      : null,
    reversal_of_payment_id: payment.reversal_of_payment_id,
    reversed_by_payment_id: payment.reversed_by_payment_id,
    allocations: [],
    created_at: payment.created_at,
  };
}

const detail = http.get('/api/v1/payments/:id', ({ params }) =>
  HttpResponse.json(paymentDetailFactory({ id: params.id as string })),
);

/** [16.6.2] `POST /payments/:id/reverse` — default success fixture; the
 * dialog's own tests override per-scenario (success, 409, approval). */
const reverse = http.post('/api/v1/payments/:id/reverse', () =>
  HttpResponse.json(paymentFactory()),
);

export const paymentHandlers = {
  list,
  listEmpty,
  record,
  recordWithAllocation,
  listByStudent,
  listByStudentEmpty,
  listByGuardian,
  listByGuardianEmpty,
  listInvoicesByStudent,
  detail,
  reverse,
};

export const paymentDefaultHandlers = [
  list,
  record,
  recordWithAllocation,
  listByStudent,
  listByGuardian,
  listInvoicesByStudent,
  detail,
  reverse,
];
