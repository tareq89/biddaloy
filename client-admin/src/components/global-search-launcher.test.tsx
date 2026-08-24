import { cleanupTestState, guardianFactory, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

/**
 * [8.11.4] — a guardian result now has its own page
 * (`/guardians/$guardianId`), replacing the old "fall back to the first
 * linked student" workaround this launcher used before that page existed.
 * Rendered through the real staff layout (`_staff.tsx` mounts
 * `GlobalSearchLauncher` in the top bar on every staff route), same
 * reasoning as every other route test in this app.
 */
describe('GlobalSearchLauncher', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('selecting a guardian result navigates to its own detail page', async () => {
    const guardian = guardianFactory({
      id: 'guardian-1',
      full_name: 'Karim Rahman',
      students: [],
    });
    server.use(
      http.get('/api/v1/guardians', () =>
        HttpResponse.json({ data: [guardian], total: 1, page: 1, limit: 5, totalPages: 1 }),
      ),
      http.get('/api/v1/guardians/:id', ({ params }) =>
        HttpResponse.json(guardianFactory({ id: params.id as string, full_name: 'Karim Rahman' })),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Search (Ctrl+K)' }));
    await user.type(screen.getByRole('combobox', { name: 'Search everything' }), 'Karim');

    const option = await screen.findByRole('option', { name: /Karim Rahman/ });
    await user.click(option);

    await waitFor(() => expect(router.state.location.pathname).toBe('/guardians/guardian-1'));
  });

  it('a guardian with no linked students still shows up as a result (no longer filtered out)', async () => {
    const guardian = guardianFactory({
      id: 'guardian-2',
      full_name: 'Childless Guardian',
      students: [],
    });
    server.use(
      http.get('/api/v1/guardians', () =>
        HttpResponse.json({ data: [guardian], total: 1, page: 1, limit: 5, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Search (Ctrl+K)' }));
    await user.type(screen.getByRole('combobox', { name: 'Search everything' }), 'Childless');

    expect(await screen.findByRole('option', { name: /Childless Guardian/ })).toBeTruthy();
  });
});
