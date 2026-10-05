import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import {
  acrCriterionFactory,
  cleanupTestState,
  renderWithProviders,
  server,
} from '@biddaloy/ui/test';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AcrCriteriaSection } from './AcrCriteriaSection';

afterEach(async () => {
  await cleanupTestState();
});

// `useBlocker` needs a router in context.
function withRouter() {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <RegionConfigProvider value={REGION_BD_EN}>
          <AcrCriteriaSection />
        </RegionConfigProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return <RouterProvider router={router} />;
}

describe('AcrCriteriaSection', () => {
  it('shows the applies-to-new-ACRs notice and, after Save, the new version', async () => {
    let putBody: unknown;
    server.use(
      http.get('/api/v1/acr/criteria', () =>
        HttpResponse.json({
          id: 'v1',
          version: 1,
          criteria: [acrCriterionFactory({ id: 'c1', code: 'PUNCTUALITY', sort_order: 1 })],
        }),
      ),
      http.put('/api/v1/acr/criteria', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({ id: 'v2', version: 2, criteria: [] });
      }),
    );
    renderWithProviders(withRouter(), {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    expect(await screen.findByText(/Changes apply to new ACRs only/)).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add criterion' }));
    await user.click(screen.getByRole('button', { name: 'Save criteria' }));
    // New row is blank -> blocked client-side, nothing sent.
    expect(await screen.findByText('Code and both names are required.')).toBeTruthy();
    expect(putBody).toBeUndefined();

    // The blank row has no code yet, so its controls are named by its position.
    await user.click(screen.getByRole('button', { name: 'Remove: 2' }));
    await user.click(screen.getByRole('button', { name: 'Save criteria' }));
    await waitFor(() =>
      expect(screen.getByText('Saved as version 2. Applies to new ACRs only.')).toBeTruthy(),
    );
    expect(putBody).toMatchObject({ criteria: [{ code: 'PUNCTUALITY', sort_order: 1 }] });
  });

  it('shows the version badge, the total and a disabled move-up on the first row', async () => {
    server.use(
      http.get('/api/v1/acr/criteria', () =>
        HttpResponse.json({
          id: 'v1',
          version: 1,
          criteria: [
            acrCriterionFactory({ id: 'c1', code: 'PUNCTUALITY', sort_order: 1 }),
            acrCriterionFactory({ id: 'c2', code: 'TEAMWORK', sort_order: 2 }),
          ],
        }),
      ),
    );
    renderWithProviders(withRouter(), { locale: 'en', tenantId: 'tenant-1', role: 'ADMIN' });

    expect(await screen.findByText('Version 1')).toBeTruthy();
    expect(screen.getByText('Total 2')).toBeTruthy();
    const up = screen.getByRole('button', { name: 'Move up: PUNCTUALITY' });
    expect((up as HTMLButtonElement).disabled).toBe(true);
    const down = screen.getByRole('button', { name: 'Move down: PUNCTUALITY' });
    expect((down as HTMLButtonElement).disabled).toBe(false);
  });

  it('on a phone shows one labelled block per criterion, not the table', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      server.use(
        http.get('/api/v1/acr/criteria', () =>
          HttpResponse.json({
            id: 'v1',
            version: 1,
            criteria: [acrCriterionFactory({ id: 'c1', code: 'PUNCTUALITY', sort_order: 1 })],
          }),
        ),
      );
      renderWithProviders(withRouter(), { locale: 'en', tenantId: 'tenant-1', role: 'ADMIN' });

      expect(await screen.findByLabelText('Code')).toBeTruthy();
      expect(screen.queryByRole('table')).toBeNull();
      // One set of actions only: the table layout is not mounted as well.
      expect(screen.getAllByRole('button', { name: 'Remove: PUNCTUALITY' })).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
