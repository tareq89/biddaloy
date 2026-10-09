import { REGION_BD_BN, REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    // The table's total footer uses the app's default region (Bangla digits here),
    // not the school's mocked settings, like the other list pages' tests.
    expect(await screen.findByText(`Total ${formatNumber(5, REGION_BD_BN)}`)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request leave' })).toBeTruthy();
  });

  it('sends the request button to the new-application form with type=STAFF_LEAVE', async () => {
    server.use(
      pinEnglishRegion,
      me(),
      http.get('/api/v1/leave/balance', () => HttpResponse.json([])),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/attendance/staff/leave'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Request leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/applications/new'));
    expect(router.state.location.search).toMatchObject({ type: 'STAFF_LEAVE' });
  });

  it('shows a LEAVE_APPROVE holder a link to the pending STAFF_LEAVE inbox', async () => {
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

    const link = await screen.findByRole('link', { name: 'Pending leave applications' });
    expect(link.getAttribute('href')).toContain('/applications?');
    expect(link.getAttribute('href')).toContain('view=inbox');
    expect(link.getAttribute('href')).toContain('type=STAFF_LEAVE');
  });

  it('renders "No limit" for an unlimited (null) quota', async () => {
    server.use(
      pinEnglishRegion,
      me(),
      http.get('/api/v1/leave/balance', () =>
        HttpResponse.json([
          { leave_type: 'EARNED', annual_quota_days: null, used_days: 4, balance: null },
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/staff/leave'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const earned = (await screen.findByText('Earned')).closest('tr') as HTMLElement;
    // Quota column: the label; balance column: a dash on desktop and the label on the phone card.
    expect(within(earned).getAllByText('No limit').length).toBeGreaterThan(0);
    expect(within(earned).getByText('—')).toBeTruthy();
  });

  it('does not show the inbox link to a caller without LEAVE_APPROVE', async () => {
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
    expect(screen.queryByRole('link', { name: 'Pending leave applications' })).toBeNull();
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
