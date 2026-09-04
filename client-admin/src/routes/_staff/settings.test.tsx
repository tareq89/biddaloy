import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

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

  // TEACHER rather than STUDENT since [8.9.10]: a STUDENT never reaches
  // this route at all any more — `_staff.tsx`'s `RequireRole` redirects the
  // whole guardian audience to `/portal` before `RequirePermission` ([8.14.17])
  // ever runs (see `role-routing.test.tsx`). TEACHER is the case this test
  // was always about: a staff role that is inside the shell but still lacks
  // `SETTINGS_MANAGE`, so `RequirePermission` refuses it in place — the page
  // itself no longer carries its own inline permission check.
  it('hides the settings screen entirely from a staff role without SETTINGS_MANAGE', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/settings'],
      role: 'TEACHER',
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
      role: 'TEACHER',
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
