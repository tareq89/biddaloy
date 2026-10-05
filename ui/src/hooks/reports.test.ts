import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { setActiveTenant } from '../api/auth-state';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import { downloadCollectionsReportCsv, useCollectionsReport } from './reports';

afterEach(async () => {
  await cleanupTestState();
});

const FILTERS = {
  from: '2026-09-01',
  to: '2026-09-16',
  payment_method: 'CASH',
  received_by_user_id: 'u-1',
} as const;

function expectServerParams(query: URLSearchParams | null) {
  expect(Object.fromEntries(query!.entries())).toEqual({
    from: '2026-09-01',
    to: '2026-09-16',
    payment_method: 'CASH',
    received_by_user_id: 'u-1',
  });
}

describe('collections report hooks', () => {
  it('useCollectionsReport sends the server parameter names', async () => {
    let query: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/reports/collections', ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json({});
      }),
    );
    const { result } = renderHookWithProviders(() => useCollectionsReport(FILTERS), {
      tenantId: 'tenant-1',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expectServerParams(query);
  });

  it('downloadCollectionsReportCsv sends the same parameters', async () => {
    let query: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/reports/collections.csv', ({ request }) => {
        query = new URL(request.url).searchParams;
        return new HttpResponse('a,b', { headers: { 'Content-Type': 'text/csv' } });
      }),
    );
    setActiveTenant('tenant-1');
    // Saved only to restore them below; never called unbound.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { createObjectURL, revokeObjectURL } = URL;
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => undefined;
    try {
      await downloadCollectionsReportCsv(FILTERS);
    } finally {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    }
    expectServerParams(query);
  });
});
