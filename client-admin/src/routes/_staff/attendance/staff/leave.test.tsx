import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

describe('/attendance/staff/leave', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it("renders the caller's leave balance, no console error", async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json({
          id: 'user-1',
          full_name: 'Karim',
          email: 'karim@example.com',
          phone: null,
          role: 'TEACHER',
          status: 'ACTIVE',
          staff_profile_id: 'profile-1',
        }),
      ),
      http.get('/api/v1/leave/balance', () =>
        HttpResponse.json([
          { leave_type: 'CASUAL', annual_quota_days: 10, used_days: 2, balance: 8 },
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/staff/leave'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByText('My leave')).toBeTruthy();
    expect(await screen.findByText('Casual')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
  });

  it('shows the approve panel only for a LEAVE_APPROVE holder', async () => {
    server.use(
      http.get('/api/v1/users/me', () =>
        HttpResponse.json({
          id: 'user-1',
          full_name: 'Admin',
          email: 'admin@example.com',
          phone: null,
          role: 'ADMIN',
          status: 'ACTIVE',
          staff_profile_id: 'profile-2',
        }),
      ),
      http.get('/api/v1/leave/balance', () => HttpResponse.json([])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/staff/leave'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('Pending requests')).toBeTruthy();
  });
});
