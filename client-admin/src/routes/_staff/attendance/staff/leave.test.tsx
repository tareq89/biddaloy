import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

// The default test tenant settings say Bangla digits; pin English so locale and region agree.
const pinEnglishRegion = http.get('/api/v1/schools/:schoolId/settings', () =>
  HttpResponse.json({ version: 1, region: REGION_BD_EN }),
);

function me(overrides: Record<string, unknown> = {}) {
  return http.get('/api/v1/users/me', () =>
    HttpResponse.json({
      id: 'user-1',
      full_name: 'Karim',
      email: 'karim@example.com',
      phone: null,
      role: 'TEACHER',
      status: 'ACTIVE',
      staff_profile_id: 'profile-1',
      ...overrides,
    }),
  );
}

describe('/attendance/staff/leave', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it("renders the caller's leave balance under a Leave h1 with 'My leave' as the h2", async () => {
    server.use(
      pinEnglishRegion,
      me(),
      http.get('/api/v1/leave/balance', () =>
        HttpResponse.json(
          ['CASUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'EARNED'].map((leave_type, i) => ({
            leave_type,
            annual_quota_days: 10,
            used_days: i === 0 ? 2 : 0,
            balance: i === 0 ? 8 : 10,
          })),
        ),
      ),
    );

    const { localeReady } = renderWithRouter(routeTree, {
      initialEntries: ['/attendance/staff/leave'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });
    await localeReady;

    expect(await screen.findByRole('heading', { level: 1, name: 'Leave' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'My leave' })).toBeTruthy();
    const casual = (await screen.findByText('Casual')).closest('tr') as HTMLElement;
    expect(within(casual).getByText('8')).toBeTruthy();
    expect(await screen.findByText('Total 5')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request leave' })).toBeTruthy();
  });

  it('shows the plain "not available yet" empty state to a LEAVE_APPROVE holder, never "engineering"', async () => {
    server.use(
      pinEnglishRegion,
      me({ full_name: 'Admin', role: 'ADMIN', staff_profile_id: 'profile-2' }),
      http.get('/api/v1/leave/balance', () => HttpResponse.json([])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/staff/leave'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { name: 'Pending requests' })).toBeTruthy();
    expect(
      screen.getByText('Approving staff leave requests here is not available yet.'),
    ).toBeTruthy();
    expect(screen.queryByText(/engineering/i)).toBeNull();
  });

  it('does not show the approve panel to a caller without LEAVE_APPROVE', async () => {
    server.use(
      pinEnglishRegion,
      me(),
      http.get('/api/v1/leave/balance', () => HttpResponse.json([])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/staff/leave'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    // Positive anchor first: the page rendered.
    expect(await screen.findByRole('heading', { level: 1, name: 'Leave' })).toBeTruthy();
    expect(await screen.findByText('No leave rules yet')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Pending requests' })).toBeNull();
  });

  it('tells a user with no staff profile so, and offers no request button', async () => {
    server.use(pinEnglishRegion, me({ staff_profile_id: null }));

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/staff/leave'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByText('You have no staff profile')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Request leave' })).toBeNull();
    expect(screen.queryByText('No leave rules yet')).toBeNull();
  });
});
