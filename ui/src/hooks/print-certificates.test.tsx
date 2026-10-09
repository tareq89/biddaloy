import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { setActiveTenant } from '../api/auth-state';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { createTestQueryClient } from '../test/render-with-providers';

import {
  certificateRegisterKeys,
  createCertificateJob,
  downloadCertificateRegisterCsv,
  printHistoryKeys,
  printQueueKeys,
  reprintCertificateJob,
  reprintPrintJob,
  useCertificateRegister,
  useCertificateTemplates,
  useConfirmCertificateJob,
  useConfirmPrintJob,
  useIdCardQueue,
  usePrintQueue,
  useRevokePrintItem,
} from './print';

const page = { data: [], total: 0, page: 1, limit: 50, totalPages: 0 };

describe('certificate channel', () => {
  it('createCertificateJob posts to /certificates and returns the items with serial_no', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/certificates', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          {
            job_id: 'job-1',
            items: [
              {
                item_id: 'i-1',
                subject_id: 's-1',
                label: 'Rahim',
                values: {},
                copy_number: 1,
                verify_url: '/v/abc',
                photo_url: null,
                serial_no: 'ABC-2026-0001',
              },
            ],
            version: { id: 'v-1', definition: {} },
          },
          { status: 201 },
        );
      }),
    );
    setActiveTenant('tenant-1');
    const res = await createCertificateJob({
      template_id: 'tpl-1',
      subject_type: 'STUDENT',
      subject_ids: ['s-1'],
    });
    expect(res.items[0]?.serial_no).toBe('ABC-2026-0001');
    expect(body).toMatchObject({ template_id: 'tpl-1', subject_ids: ['s-1'] });
  });

  it('useCertificateTemplates is off until a kind is given, then sends document_kind', async () => {
    let kind: string | null = 'unset';
    server.use(
      http.get('/api/v1/certificates/templates', ({ request }) => {
        kind = new URL(request.url).searchParams.get('document_kind');
        return HttpResponse.json([]);
      }),
    );
    const idle = renderHookWithProviders(() => useCertificateTemplates(undefined), {
      tenantId: 'tenant-1',
    });
    expect(idle.result.current.fetchStatus).toBe('idle');
    const { result } = renderHookWithProviders(() => useCertificateTemplates('TESTIMONIAL'), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(kind).toBe('TESTIMONIAL');
  });

  it('useConfirmCertificateJob patches /certificates/jobs/:id/confirm and invalidates history, register and queue', async () => {
    let body: unknown;
    server.use(
      http.patch('/api/v1/certificates/jobs/job-1/confirm', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ job_id: 'job-1', status: 'CONFIRMED', failed_item_ids: [] });
      }),
    );
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHookWithProviders(() => useConfirmCertificateJob(), {
      tenantId: 'tenant-1',
      queryClient,
    });
    await result.current.mutateAsync({ jobId: 'job-1', failedItemIds: [] });
    expect(body).toEqual({ failed_item_ids: [] });
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(certificateRegisterKeys.all);
    expect(keys).toContainEqual(printQueueKeys.all);
    expect(keys).toContainEqual(printHistoryKeys.all);
  });

  it('reprintCertificateJob posts to /certificates/jobs/:id/reprint', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/certificates/jobs/job-1/reprint', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          job_id: 'job-2',
          items: [],
          version: { id: 'v', definition: {} },
        });
      }),
    );
    setActiveTenant('tenant-1');
    const res = await reprintCertificateJob('job-1', ['i-1']);
    expect(res.job_id).toBe('job-2');
    expect(body).toEqual({ item_ids: ['i-1'] });
  });
});

describe('student-certificate routing of the shared confirm / reprint helpers', () => {
  it('useConfirmPrintJob goes to /certificates/jobs for a certificate kind and refreshes the register', async () => {
    let hit = '';
    server.use(
      http.patch('/api/v1/certificates/jobs/job-1/confirm', () => {
        hit = 'certificates';
        return HttpResponse.json({ job_id: 'job-1', status: 'CONFIRMED', failed_item_ids: [] });
      }),
      http.patch('/api/v1/print-jobs/job-1/confirm', () => {
        hit = 'print-jobs';
        return HttpResponse.json({ job_id: 'job-1', status: 'CONFIRMED', failed_item_ids: [] });
      }),
    );
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHookWithProviders(() => useConfirmPrintJob(), {
      tenantId: 'tenant-1',
      queryClient,
    });
    await result.current.mutateAsync({
      jobId: 'job-1',
      failedItemIds: [],
      kind: 'TRANSFER_CERTIFICATE',
    });
    expect(hit).toBe('certificates');
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual(certificateRegisterKeys.all);
  });

  it('useConfirmPrintJob keeps /print-jobs for ID cards and when no kind is given', async () => {
    const hits: string[] = [];
    server.use(
      http.patch('/api/v1/print-jobs/job-1/confirm', () => {
        hits.push('print-jobs');
        return HttpResponse.json({ job_id: 'job-1', status: 'CONFIRMED', failed_item_ids: [] });
      }),
    );
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHookWithProviders(() => useConfirmPrintJob(), {
      tenantId: 'tenant-1',
      queryClient,
    });
    await result.current.mutateAsync({
      jobId: 'job-1',
      failedItemIds: [],
      kind: 'STUDENT_ID_CARD',
    });
    // An ID-card confirm changes the to-print queue, not the certificate register.
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(printQueueKeys.all);
    expect(keys).not.toContainEqual(certificateRegisterKeys.all);
    await result.current.mutateAsync({ jobId: 'job-1', failedItemIds: [] });
    expect(hits).toEqual(['print-jobs', 'print-jobs']);
  });

  it('useRevokePrintItem refreshes history, the register and the to-print queue', async () => {
    server.use(
      http.post('/api/v1/print-history/items/i-1/revoke', () =>
        HttpResponse.json({ item_id: 'i-1', revoked_at: '2026-10-08T00:00:00.000Z' }),
      ),
    );
    const queryClient = createTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHookWithProviders(() => useRevokePrintItem(), {
      tenantId: 'tenant-1',
      queryClient,
    });
    await result.current.mutateAsync({ itemId: 'i-1', reason: 'Lost' });
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(printHistoryKeys.all);
    expect(keys).toContainEqual(certificateRegisterKeys.all);
    expect(keys).toContainEqual(printQueueKeys.all);
  });

  it('reprintPrintJob picks the path from the kind', async () => {
    const hits: string[] = [];
    const ok = { job_id: 'j', items: [], version: { id: 'v', definition: {} } };
    server.use(
      http.post('/api/v1/certificates/jobs/job-1/reprint', () => {
        hits.push('certificates');
        return HttpResponse.json(ok);
      }),
      http.post('/api/v1/print-jobs/job-1/reprint', () => {
        hits.push('print-jobs');
        return HttpResponse.json(ok);
      }),
    );
    setActiveTenant('tenant-1');
    await reprintPrintJob('job-1', ['i'], 'TESTIMONIAL');
    await reprintPrintJob('job-1', ['i'], 'EXAM_ADMIT_CARD');
    await reprintPrintJob('job-1', ['i']);
    expect(hits).toEqual(['certificates', 'print-jobs', 'print-jobs']);
  });
});

describe('certificate register and queue', () => {
  it('useCertificateRegister sends year and status and no undefined keys', async () => {
    let search = '';
    server.use(
      http.get('/api/v1/print-history/register', ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json(page);
      }),
    );
    const { result } = renderHookWithProviders(
      () => useCertificateRegister({ year: 2026, status: 'REVOKED' }),
      { tenantId: 'tenant-1' },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(search).toBe('?year=2026&status=REVOKED');
  });

  it('downloadCertificateRegisterCsv asks for the .csv path with the same params', async () => {
    let search = '';
    server.use(
      http.get('/api/v1/print-history/register.csv', ({ request }) => {
        search = new URL(request.url).search;
        return new HttpResponse('a,b', { headers: { 'Content-Type': 'text/csv' } });
      }),
    );
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    setActiveTenant('tenant-1');
    await downloadCertificateRegisterCsv({ year: 2026, status: 'VALID' });
    expect(search).toBe('?year=2026&status=VALID');
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it('usePrintQueue reads /print-history/queue', async () => {
    server.use(
      http.get('/api/v1/print-history/queue', () =>
        HttpResponse.json({ total: 3, by_kind: [], exams: [] }),
      ),
    );
    const { result } = renderHookWithProviders(() => usePrintQueue(), { tenantId: 'tenant-1' });
    await waitFor(() => expect(result.current.data?.total).toBe(3));
  });

  it('useIdCardQueue sends page and limit', async () => {
    let search = '';
    server.use(
      http.get('/api/v1/print-history/queue/id-cards', ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json(page);
      }),
    );
    const { result } = renderHookWithProviders(() => useIdCardQueue({ page: 2, limit: 20 }), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(search).toBe('?page=2&limit=20');
  });
});
