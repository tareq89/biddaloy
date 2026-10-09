import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

describe('/welcome', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('is refused to a TEACHER, in place', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/welcome'],
      tenantId: 'tenant-1',
      role: UserRole.TEACHER,
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByText("You don't have access to this page.")).toBeTruthy(),
    );
    expect(router.state.location.pathname).toBe('/welcome');
  });

  it('shows the setup wizard to an ADMIN', async () => {
    server.use(
      http.get('/api/v1/onboarding/status', () =>
        HttpResponse.json({
          finished_at: null,
          dismissed_at: null,
          seen: false,
          setup_path: null,
          items: [],
          counts: { classes: 0, sections: 0, students: 0, staff: 0 },
          trial: null,
          support_url: null,
        }),
      ),
      http.patch('/api/v1/onboarding', () => HttpResponse.json({})),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/welcome'],
      tenantId: 'tenant-1',
      role: UserRole.ADMIN,
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { name: 'Set up your school' })).toBeTruthy();
  });
});
