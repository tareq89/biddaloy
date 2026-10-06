import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

describe('/auth/social/done', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  // The server passes the sign-in's deep link back as `?redirect=` (social-auth.service.ts).
  it('takes a signed-in visitor to the page they were trying to reach', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/auth/social/done?redirect=%2Fstudents'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
  });

  it('drops a redirect that leaves the app', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/auth/social/done?redirect=//evil.com'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  });
});
