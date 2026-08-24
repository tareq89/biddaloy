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
};

export const paymentDefaultHandlers = [
  list,
  record,
  recordWithAllocation,
  listByStudent,
  listByGuardian,
  listInvoicesByStudent,
];
