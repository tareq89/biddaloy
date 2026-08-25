import { ROLE_PERMISSIONS, UserRole } from '@biddaloy/shared';
import {
  auditEntryFactory,
  cleanupTestState,
  teacherFactory,
  userResponseFactory,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

function fakeToken(sub: string): string {
  const payload = btoa(JSON.stringify({ sub })).replace(/=+$/, '');
  return `header.${payload}.signature`;
}

function paginated<T>(data: T[]) {
  return { data, total: data.length, page: 1, limit: 10, totalPages: 1 };
}

/**
 * [8.11.8]'s staff detail — Profile · Permissions (read-only from
 * `ROLE_PERMISSIONS`) · Memberships · Login History, against the real
 * route tree, same reasoning as `guardians/$guardianId.test.tsx`.
 */
describe('/staff/$userId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the Profile tab by default, including the teacher profile when one exists', async () => {
    const user = userResponseFactory({
      id: 'user-1',
      full_name: 'Abdul Karim',
      email: 'karim@example.com',
      role: 'TEACHER',
      status: 'ACTIVE',
    });
    server.use(
      http.get('/api/v1/users/:id', () => HttpResponse.json(user)),
      http.get('/api/v1/teachers', () =>
        HttpResponse.json(paginated([teacherFactory({ user, employee_id: 'EMP-77' })])),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/staff/user-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Profile', selected: true })).toBeTruthy(),
    );
    expect(screen.getByText('karim@example.com')).toBeTruthy();
    await screen.findByText('EMP-77');
    // Status conveyed by label text, not colour alone.
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
  });

  it("deep-links via ?tab= — the Permissions tab lists exactly ROLE_PERMISSIONS for the user's role, read-only", async () => {
    const user = userResponseFactory({ id: 'user-1', role: 'TEACHER' });
    server.use(
      http.get('/api/v1/users/:id', () => HttpResponse.json(user)),
      http.get('/api/v1/teachers', () => HttpResponse.json(paginated([]))),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/staff/user-1?tab=permissions'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Permissions', selected: true })).toBeTruthy(),
    );
    expect(
      screen.getByText(
        'Permissions follow the role — the server enforces this same list. They cannot be edited per person.',
      ),
    ).toBeTruthy();
    // Every TEACHER permission renders, humanized; an ADMIN-only one does not.
    for (const permission of ROLE_PERMISSIONS[UserRole.TEACHER]) {
      const label =
        permission.toLowerCase().replace(/_/g, ' ').charAt(0).toUpperCase() +
        permission.toLowerCase().replace(/_/g, ' ').slice(1);
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByText('Member remove')).toBeNull();
    // Read-only: nothing in the tab is an editable control.
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it("Memberships tab shows this school's single membership plus the isolation note", async () => {
    const user = userResponseFactory({
      id: 'user-1',
      role: 'ACCOUNTANT',
      created_at: '2025-02-01T00:00:00.000Z',
    });
    server.use(
      http.get('/api/v1/users/:id', () => HttpResponse.json(user)),
      http.get('/api/v1/teachers', () => HttpResponse.json(paginated([]))),
      // Default tenant settings carry Bangla numerals — omitting `region`
      // falls back to the locale-derived Latin-digit default, same trick
      // `guardians/$guardianId.test.tsx` documents for phone parsing.
      http.get('/api/v1/schools/:id/settings', () => HttpResponse.json({ version: 1 })),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/staff/user-1?tab=memberships'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('Member since')).toBeTruthy();
    expect(await screen.findByText('2025-02-01')).toBeTruthy();
    expect((await screen.findAllByText('Accountant')).length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Only this school's membership is shown. Memberships at other schools are not visible from here.",
      ),
    ).toBeTruthy();
  });

  it('Login History tab renders LOGIN audit rows for an ADMIN', async () => {
    const user = userResponseFactory({ id: 'user-1' });
    let params: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/users/:id', () => HttpResponse.json(user)),
      http.get('/api/v1/teachers', () => HttpResponse.json(paginated([]))),
      http.get('/api/v1/audit-logs', ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json(
          paginated([
            auditEntryFactory({
              action: 'LOGIN',
              performed_by_user_id: 'user-1',
              ip_address: '203.0.113.9',
            }),
          ]),
        );
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/staff/user-1?tab=loginHistory'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('203.0.113.9');
    expect(params!.get('action')).toBe('LOGIN');
    expect(params!.get('performed_by_user_id')).toBe('user-1');
  });

  it('Login History tab is absent for a role without AUDIT_LOG_READ (ACCOUNTANT)', async () => {
    const user = userResponseFactory({ id: 'user-1', full_name: 'Abdul Karim' });
    server.use(
      http.get('/api/v1/users/:id', () => HttpResponse.json(user)),
      http.get('/api/v1/teachers', () => HttpResponse.json(paginated([]))),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/staff/user-1'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    await screen.findByRole('tab', { name: 'Profile' });
    expect(screen.queryByRole('tab', { name: 'Login history' })).toBeNull();
  });

  it('remove-from-school is disabled with an explanation when viewing your own account', async () => {
    const self = userResponseFactory({ id: 'me', full_name: 'Own Account' });
    server.use(
      http.get('/api/v1/users/:id', () => HttpResponse.json(self)),
      http.get('/api/v1/teachers', () => HttpResponse.json(paginated([]))),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/staff/me'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
      accessToken: fakeToken('me'),
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remove from school' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('You cannot remove your own account from this school.'),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole('button', { name: 'Remove access' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('removing another member navigates back to the list on success', async () => {
    const other = userResponseFactory({ id: 'user-2', full_name: 'Other Person' });
    server.use(
      http.get('/api/v1/users/:id', () => HttpResponse.json(other)),
      http.get('/api/v1/users', () => HttpResponse.json(paginated([]))),
      http.get('/api/v1/teachers', () => HttpResponse.json(paginated([]))),
      http.delete('/api/v1/users/:id', () => new HttpResponse(null, { status: 204 })),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/staff/user-2'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
      accessToken: fakeToken('me'),
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remove from school' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove access' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/staff'));
  });

  it('is axe clean', async () => {
    const user = userResponseFactory({ id: 'user-1', full_name: 'Abdul Karim' });
    server.use(
      http.get('/api/v1/users/:id', () => HttpResponse.json(user)),
      http.get('/api/v1/teachers', () => HttpResponse.json(paginated([]))),
    );

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/staff/user-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Abdul Karim');
    await expect(container).toHaveNoViolations();
  });
});
