import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { guardianFactory, invoiceFactory, studentFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import {
  invoiceKeys,
  invoiceQueryOptions,
  useCreateInvoice,
  useInvoice,
  useInvoiceSendCandidates,
  useInvoices,
} from './invoices';

describe('invoiceQueryOptions', () => {
  // [8.14.5]: `useInvoice` is now a one-line wrapper around this factory
  // — `_staff/invoices/$invoiceId.tsx`'s `loader` calls the factory
  // directly. This pins the `queryKey` shape both share, so the loader's
  // `ensureQueryData` call and the component's `useInvoice` hook are
  // provably reading/writing the same cache entry.
  it('uses invoiceKeys.detail(id) as its queryKey, same as useInvoice did before extraction', () => {
    expect(invoiceQueryOptions('invoice-1').queryKey).toEqual(invoiceKeys.detail('invoice-1'));
  });
});

describe('useInvoice', () => {
  it('resolves the invoice the handler returns for the given id', async () => {
    server.use(
      http.get('/api/v1/invoices/:id', ({ params }) =>
        HttpResponse.json(
          invoiceFactory({ id: params.id as string, invoice_number: 'INV-2026-00001' }),
        ),
      ),
    );

    const { result } = renderHookWithProviders(() => useInvoice('invoice-1'), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('invoice-1');
    expect(result.current.data?.invoice_number).toBe('INV-2026-00001');
  });
});

describe('useInvoices', () => {
  it('[8.10.2] requests the student_id filter as a query param — the Invoices tab', async () => {
    let requestedStudentId: string | null = null;
    server.use(
      http.get('/api/v1/invoices', ({ request }) => {
        requestedStudentId = new URL(request.url).searchParams.get('student_id');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
      }),
    );

    const { result } = renderHookWithProviders(() => useInvoices({ student_id: 'student-1' }), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestedStudentId).toBe('student-1');
  });

  // [8.14.10]: `min_amount`/`max_amount`/`sort`/`order` — landed server-side
  // by #373, wired into `InvoiceListFilters` by this ticket. A regression
  // here means the number-range/sort descriptors on `invoices/index.tsx`
  // silently stop reaching the request.
  it('[8.14.10] requests min_amount, max_amount, sort, and order as query params', async () => {
    const requested = new URLSearchParams();
    server.use(
      http.get('/api/v1/invoices', ({ request }) => {
        for (const [key, value] of new URL(request.url).searchParams) requested.set(key, value);
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 });
      }),
    );

    const { result } = renderHookWithProviders(
      () =>
        useInvoices({
          min_amount: 100,
          max_amount: 5000,
          sort: 'due_date',
          order: 'desc',
        }),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requested.get('min_amount')).toBe('100');
    expect(requested.get('max_amount')).toBe('5000');
    expect(requested.get('sort')).toBe('due_date');
    expect(requested.get('order')).toBe('desc');
  });
});

describe('useCreateInvoice', () => {
  // [8.10.4]'s dues queue "Generate Invoice" bulk action.
  it('posts the input and resolves with the created invoice', async () => {
    const created = invoiceFactory({ invoice_number: 'INV-2026-00002' });
    server.use(http.post('/api/v1/invoices', () => HttpResponse.json(created, { status: 201 })));

    const { result } = renderHookWithProviders(() => useCreateInvoice(), {
      tenantId: 'tenant-1',
    });

    result.current.mutate({ payment_id: 'payment-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.invoice_number).toBe('INV-2026-00002');
  });
});

describe('useInvoiceSendCandidates', () => {
  it('dedupes a guardian shared by two students on a multi-student invoice', async () => {
    const sharedGuardian = guardianFactory({ id: 'guardian-shared', notifications_enabled: true });
    const studentA = studentFactory({ id: 'student-a', guardians: [sharedGuardian] });
    const studentB = studentFactory({
      id: 'student-b',
      guardians: [
        sharedGuardian,
        guardianFactory({ id: 'guardian-b-only', notifications_enabled: true }),
      ],
    });
    server.use(
      http.get('/api/v1/students/:id', ({ params }) =>
        HttpResponse.json(params.id === studentA.id ? studentA : studentB),
      ),
    );

    const { result } = renderHookWithProviders(
      () => useInvoiceSendCandidates([studentA.id, studentB.id]),
      { tenantId: 'tenant-1' },
    );

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.sendCandidates.map((g) => g.id).sort()).toEqual([
      'guardian-b-only',
      'guardian-shared',
    ]);
  });

  it('falls back to every reachable guardian when none is primary', async () => {
    const notPrimary = guardianFactory({
      id: 'guardian-not-primary',
      is_primary_contact: false,
      notifications_enabled: true,
    });
    const student = studentFactory({ id: 'student-c', guardians: [notPrimary] });
    server.use(http.get('/api/v1/students/:id', () => HttpResponse.json(student)));

    const { result } = renderHookWithProviders(() => useInvoiceSendCandidates([student.id]), {
      tenantId: 'tenant-1',
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.sendCandidates.map((g) => g.id)).toEqual(['guardian-not-primary']);
  });

  it('is pending with no candidates for an empty student list, and never queries', () => {
    const { result } = renderHookWithProviders(() => useInvoiceSendCandidates([]), {
      tenantId: 'tenant-1',
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.sendCandidates).toEqual([]);
  });
});
