import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

describe('/fees', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('redirects to /fees/dues', async () => {
    server.use(
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/fees'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/fees/dues'));
  });
});
