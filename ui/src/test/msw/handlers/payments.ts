import { http, HttpResponse } from 'msw';

import { invoiceFactory, paymentFactory, type Invoice, type Payment } from '../../factories';

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

const listInvoicesByStudent = http.get(
  '/api/v1/payments/invoices/student/:studentId',
  ({ params }) =>
    HttpResponse.json(
      [invoiceFactory(), invoiceFactory()].map((invoice): Invoice => ({
        ...invoice,
        student: { ...invoice.student, id: params.studentId as string },
      })),
    ),
);

export const paymentHandlers = {
  record,
  recordWithAllocation,
  listByStudent,
  listByStudentEmpty,
  listInvoicesByStudent,
};

export const paymentDefaultHandlers = [
  record,
  recordWithAllocation,
  listByStudent,
  listInvoicesByStudent,
];
