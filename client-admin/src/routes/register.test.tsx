import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

describe('/register', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('sends a signed-in visitor away instead of showing the sign-up card', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/register'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).not.toBe('/register'));
  });
});
