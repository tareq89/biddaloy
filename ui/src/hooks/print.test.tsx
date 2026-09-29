import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { setActiveTenant } from '../api/auth-state';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { createTestQueryClient } from '../test/render-with-providers';

import {
  createPrintJob,
  printTemplateKeys,
  usePrintHistory,
  usePrintTemplate,
  usePrintTemplates,
  usePublishPrintTemplate,
  type PrintTemplateRow,
} from './print';

const template = (over: Partial<PrintTemplateRow> = {}): PrintTemplateRow => ({
  id: 'tpl-1',
  name: 'Classic',
  document_kind: 'STUDENT_ID_CARD',
  layout_kind: 'FIXED',
  is_default: false,
  batch_size: 50,
  current_version_id: null,
  archived_at: null,
  created_at: '2027-01-01T00:00:00.000Z',
  updated_at: '2027-01-01T00:00:00.000Z',
  ...over,
});

describe('print templates', () => {
  it('lists templates, and sends the document kind as a query parameter', async () => {
    let seenKind: string | null = 'unset';
    server.use(
      http.get('/api/v1/print-templates', ({ request }) => {
        seenKind = new URL(request.url).searchParams.get('document_kind');
        return HttpResponse.json([template()]);
      }),
    );
    const { result } = renderHookWithProviders(() => usePrintTemplates('STUDENT_ID_CARD'), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(seenKind).toBe('STUDENT_ID_CARD');
  });

  it('publishing refetches both the list and the detail', async () => {
    let listCalls = 0;
    let detailCalls = 0;
    server.use(
      http.get('/api/v1/print-templates', () => {
        listCalls += 1;
        return HttpResponse.json([template()]);
      }),
      http.get('/api/v1/print-templates/tpl-1', () => {
        detailCalls += 1;
        return HttpResponse.json(template());
      }),
      http.post('/api/v1/print-templates/tpl-1/publish', () =>
        HttpResponse.json({
          id: 'v-1',
          template_id: 'tpl-1',
          version: 1,
          definition: {},
          published_at: 'x',
        }),
      ),
    );
    const queryClient = createTestQueryClient();
    const { result } = renderHookWithProviders(
      () => ({
        list: usePrintTemplates(),
        detail: usePrintTemplate('tpl-1'),
        publish: usePublishPrintTemplate('tpl-1'),
      }),
      { tenantId: 'tenant-1', queryClient },
    );
    await waitFor(() =>
      expect(result.current.list.isSuccess && result.current.detail.isSuccess).toBe(true),
    );
    expect([listCalls, detailCalls]).toEqual([1, 1]);

    result.current.publish.mutate();

    // Both cached queries are stale once a new version exists, so both refetch.
    await waitFor(() => expect([listCalls, detailCalls]).toEqual([2, 2]));
    expect(queryClient.getQueryState(printTemplateKeys.detail('tpl-1'))?.isInvalidated).toBe(false);
  });
});

describe('createPrintJob', () => {
  it('returns the server-built items and version, and sends only ids (never field values)', async () => {
    let body: unknown;
    server.use(
      http.post('/api/v1/print-jobs', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          {
            job_id: 'job-1',
            items: [
              {
                item_id: 'i-1',
                subject_id: 's-1',
                label: 'Rahim',
                values: { 'student.name': 'Rahim' },
                copy_number: 1,
                verify_url: '/v/abc',
                photo_url: null,
              },
            ],
            version: { id: 'v-1', definition: {} },
          },
          { status: 201 },
        );
      }),
    );
    // No hook provider around a plain function, so set the tenant the request needs.
    setActiveTenant('tenant-1');
    const res = await createPrintJob({
      template_id: 'tpl-1',
      subject_type: 'STUDENT',
      subject_ids: ['s-1'],
    });
    expect(res.job_id).toBe('job-1');
    expect(res.items[0]?.copy_number).toBe(1);
    expect(body).toEqual({ template_id: 'tpl-1', subject_type: 'STUDENT', subject_ids: ['s-1'] });
  });
});

describe('usePrintHistory', () => {
  it('puts every filter into the query string', async () => {
    let params: URLSearchParams | undefined;
    server.use(
      http.get('/api/v1/print-history', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json({ data: [], total: 0, page: 2, limit: 10, totalPages: 0 });
      }),
    );
    const { result } = renderHookWithProviders(
      () =>
        usePrintHistory({
          subject_type: 'STAFF',
          outcome: 'FAILED',
          revoked: false,
          q: 'rah',
          page: 2,
          limit: 10,
        }),
      { tenantId: 'tenant-1' },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Object.fromEntries(params ?? [])).toEqual({
      subject_type: 'STAFF',
      outcome: 'FAILED',
      revoked: 'false',
      q: 'rah',
      page: '2',
      limit: '10',
    });
  });
});
