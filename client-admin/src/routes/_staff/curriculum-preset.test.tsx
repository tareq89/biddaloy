import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

/** [35.5.1] `/curriculum-preset` is gated on CURRICULUM_PRESET_APPLY (ADMIN). */
describe('/curriculum-preset', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('refuses a staff role without CURRICULUM_PRESET_APPLY in place', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/curriculum-preset'],
      role: 'TEACHER',
      tenantId: 'tenant-1',
      locale: 'en',
    });
    await waitFor(() => {
      expect(screen.getByText("You don't have access to this page.")).toBeTruthy();
    });
  });

  it('lets an ADMIN through the permission gate', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/curriculum-preset'],
      role: 'ADMIN',
      tenantId: 'tenant-1',
      locale: 'en',
    });
    await waitFor(() => {
      expect(screen.queryByText("You don't have access to this page.")).toBeNull();
    });
  });
});
