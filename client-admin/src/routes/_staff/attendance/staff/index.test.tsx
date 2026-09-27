import { cleanupTestState, paginate, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

describe('/attendance/staff', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders a row per staff member with a staff profile, no console error', async () => {
    server.use(
      http.get('/api/v1/users', ({ request }) =>
        HttpResponse.json(
          paginate(
            [
              {
                id: 'user-1',
                full_name: 'Karim',
                email: 'karim@example.com',
                phone: null,
                role: 'TEACHER',
                status: 'ACTIVE',
                staff_profile_id: 'profile-1',
              },
            ],
            request.url,
          ),
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByRole('button', { name: 'Karim' })).toBeTruthy();
  });

  it('shows an empty state when there is no staff with a profile yet', async () => {
    server.use(
      http.get('/api/v1/users', ({ request }) => HttpResponse.json(paginate([], request.url))),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('No staff yet')).toBeTruthy();
  });
});
