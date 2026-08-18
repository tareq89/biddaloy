import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

/**
 * Ported from the pre-[8.9.1] `App.test.tsx` — `App.tsx`'s own comment
 * promised "a real router/nav can replace this function's body wholesale
 * without anything under `pages/` changing," and that's exactly what
 * happened: same three assertions, now mounted through the real route
 * tree at `/settings` instead of rendering `<App />` directly.
 */
describe('/settings', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('hides the settings screen entirely from a role without SETTINGS_MANAGE', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/settings'],
      role: 'STUDENT',
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => {
      expect(screen.getByText("You don't have access to this page.")).toBeTruthy();
    });
  });

  it('has no accessibility violations on the access-denied screen', async () => {
    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/settings'],
      role: 'STUDENT',
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => screen.getByText("You don't have access to this page."));
    await expect(container).toHaveNoViolations();
  });

  it('renders the settings screen for an ADMIN, who holds SETTINGS_MANAGE', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/settings'],
      role: 'ADMIN',
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => {
      expect(screen.getByText('School settings')).toBeTruthy();
    });
    // ADMIN has no school picker — they only ever configure their own tenant.
    expect(screen.queryByLabelText('School')).toBeNull();
  });
});
