import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { invoiceFactory } from '../test/factories';
import { server } from '../test/msw/server';
import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useInvoice } from './invoices';

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
