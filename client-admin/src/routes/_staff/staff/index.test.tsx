import {
  apiErrorBody,
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

/** A structurally valid (unsigned) JWT whose `sub` is the given user id —
 * what `useCurrentUserId` decodes for the self-removal guard. */
function fakeToken(sub: string): string {
  const payload = btoa(JSON.stringify({ sub })).replace(/=+$/, '');
  return `header.${payload}.signature`;
}

function paginated<T>(data: T[]) {
  return { data, total: data.length, page: 1, limit: 10, totalPages: 1 };
}

/**
 * [8.11.8]'s Staff list — against the real route tree, same reasoning as
 * `guardians/index.test.tsx`'s own header comment.
 */
describe('/staff', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists users with name, email, phone, role, status, and joined date', async () => {
    const user = userResponseFactory({
      id: 'user-1',
      full_name: 'Abdul Karim',
      email: 'karim@example.com',
      phone: '+8801712345678',
      role: 'ACCOUNTANT',
      status: 'ACTIVE',
      created_at: '2025-04-10T00:00:00.000Z',
    });
    server.use(
      http.get('/api/v1/users', () => HttpResponse.json(paginated([user]))),
      // Latin-digit region + parseable `+880...` numbers — same override
      // `guardians/$guardianId.test.tsx` documents.
      http.get('/api/v1/schools/:id/settings', () => HttpResponse.json({ version: 1 })),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('Abdul Karim')).toBeTruthy());
    expect(screen.getByText('karim@example.com')).toBeTruthy();
    expect(screen.getByText('+880 1712-345678')).toBeTruthy();
    expect(screen.getByText('Accountant')).toBeTruthy();
    // Status is conveyed by label text, not colour alone (StatusBadge).
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('2025-04-10')).toBeTruthy();
  });

  it('filters by role using the shared UserRole enum as a query param', async () => {
    let requestedRole: string | null = null;
    server.use(
      http.get('/api/v1/users', ({ request }) => {
        requestedRole = new URL(request.url).searchParams.get('role');
        return HttpResponse.json(paginated([]));
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/staff?role=TEACHER'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(requestedRole).toBe('TEACHER'));
  });

  it('debounces the search box before it changes the request', async () => {
    let requestedSearch: string | null = null;
    server.use(
      http.get('/api/v1/users', ({ request }) => {
        requestedSearch = new URL(request.url).searchParams.get('search');
        return HttpResponse.json(paginated([]));
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    const searchBox = await screen.findByRole('textbox', { name: 'Search by name or email' });
    await user.type(searchBox, 'Karim');

    expect(requestedSearch).toBeNull();
    await waitFor(() => expect(requestedSearch).toBe('Karim'), { timeout: 1000 });
  });

  it('shows the empty message when no users match', async () => {
    server.use(http.get('/api/v1/users', () => HttpResponse.json(paginated([]))));

    renderWithRouter(routeTree, {
      initialEntries: ['/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('No users found')).toBeTruthy());
  });

  it('renders a Bangla-script user name correctly', async () => {
    const user = userResponseFactory({ id: 'user-1' }, { script: 'bn' });
    server.use(http.get('/api/v1/users', () => HttpResponse.json(paginated([user]))));

    renderWithRouter(routeTree, {
      initialEntries: ['/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(user.full_name)).toBeTruthy());
  });

  it('promote dialog frames promotion around existing members, excluding those who already hold a teacher profile, and can be completed keyboard-only', async () => {
    const member = userResponseFactory({ id: 'user-1', full_name: 'Abdul Karim' });
    const alreadyTeacher = userResponseFactory({ id: 'user-2', full_name: 'Rahima Begum' });
    let postBody: unknown = null;
    server.use(
      http.get('/api/v1/users', () => HttpResponse.json(paginated([member, alreadyTeacher]))),
      http.get('/api/v1/teachers', () =>
        HttpResponse.json(paginated([teacherFactory({ user: alreadyTeacher })])),
      ),
      http.post('/api/v1/teachers', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json(teacherFactory(), { status: 201 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    const openButton = await screen.findByRole('button', { name: 'Promote to teacher' });
    openButton.focus();
    await user.keyboard('{Enter}');

    // The member Combobox's own popover also carries role="dialog" (and the
    // dialog's autofocus can open it) — select the outer dialog by name.
    const dialog = await screen.findByRole('dialog', { name: 'Promote a member to teacher' });

    // Keyboard-only: type into the combobox, pick the first option.
    const picker = within(dialog).getByRole('combobox', { name: 'Member' });
    await user.click(picker);
    await user.type(picker, 'a');
    // The member with an existing teacher profile is not offered.
    // Options live in the Combobox's portalled popover, outside the dialog.
    await waitFor(() => expect(screen.getByRole('option', { name: 'Abdul Karim' })).toBeTruthy());
    expect(screen.queryByRole('option', { name: 'Rahima Begum' })).toBeNull();
    await user.keyboard('{ArrowDown}{Enter}');

    await user.type(within(dialog).getByLabelText('Employee ID'), 'EMP-42');
    await user.click(within(dialog).getByLabelText('Class teacher'));
    await user.type(within(dialog).getByLabelText('Subject specialization'), 'Mathematics');

    await user.click(within(dialog).getByRole('button', { name: 'Promote to teacher' }));

    await waitFor(() =>
      expect(postBody).toEqual({
        user_id: 'user-1',
        employee_id: 'EMP-42',
        designations: ['CLASS_TEACHER'],
        subject_specialization: 'Mathematics',
      }),
    );
  });

  it('promote dialog surfaces a 409 duplicate-employee-id inline, without claiming per-school uniqueness', async () => {
    const member = userResponseFactory({ id: 'user-1', full_name: 'Abdul Karim' });
    server.use(
      http.get('/api/v1/users', () => HttpResponse.json(paginated([member]))),
      http.get('/api/v1/teachers', () => HttpResponse.json(paginated([]))),
      http.post('/api/v1/teachers', () =>
        HttpResponse.json(apiErrorBody(409, 'exists', '/api/v1/teachers'), { status: 409 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Promote to teacher' }));
    const dialog = await screen.findByRole('dialog', { name: 'Promote a member to teacher' });
    const picker = within(dialog).getByRole('combobox', { name: 'Member' });
    await user.click(picker);
    await user.type(picker, 'Abdul');
    await user.keyboard('{ArrowDown}{Enter}');
    await user.type(within(dialog).getByLabelText('Employee ID'), 'EMP-42');
    await user.click(within(dialog).getByRole('button', { name: 'Promote to teacher' }));

    // employee_id is globally unique — the copy must not say "in this school".
    const alert = await within(dialog).findByText(
      'This employee ID is already in use. Employee IDs are unique across all schools.',
    );
    expect(alert).toBeTruthy();
  });

  it('add-user dialog surfaces a 409 duplicate email inline', async () => {
    server.use(
      http.get('/api/v1/users', () => HttpResponse.json(paginated([]))),
      http.post('/api/v1/users', () =>
        HttpResponse.json(apiErrorBody(409, 'duplicate', '/api/v1/users'), { status: 409 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add user' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Full name'), 'New Person');
    await user.click(within(dialog).getByRole('combobox', { name: 'Role' }));
    await user.click(await screen.findByRole('option', { name: 'Accountant' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add user' }));

    expect(await within(dialog).findByText('A user with this email already exists.')).toBeTruthy();
  });

  it('self-removal is prevented: the confirm stays disabled with an explanation for your own row', async () => {
    const self = userResponseFactory({ id: 'me', full_name: 'Own Account' });
    server.use(http.get('/api/v1/users', () => HttpResponse.json(paginated([self]))));

    renderWithRouter(routeTree, {
      initialEntries: ['/staff'],
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

  it("removing another member shows the server's own guard message when it answers 400", async () => {
    const other = userResponseFactory({ id: 'user-2', full_name: 'Other Person' });
    server.use(
      http.get('/api/v1/users', () => HttpResponse.json(paginated([other]))),
      http.delete('/api/v1/users/:id', () =>
        HttpResponse.json(
          apiErrorBody(400, 'You cannot remove your own account from this school', '/api/v1/users'),
          { status: 400 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
      accessToken: fakeToken('me'),
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Remove from school' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove access' }));

    expect(
      await within(dialog).findByText('You cannot remove your own account from this school.'),
    ).toBeTruthy();
  });

  it('is axe clean', async () => {
    const user = userResponseFactory({ id: 'user-1', full_name: 'Abdul Karim' });
    server.use(http.get('/api/v1/users', () => HttpResponse.json(paginated([user]))));

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Abdul Karim');
    await expect(container).toHaveNoViolations();
  });

  // [8.14.10]: FilterBar migration — the rows-per-page control changes
  // `limit` and resets `page` in one URL update.
  it('changing rows per page writes limit and resets page', async () => {
    server.use(http.get('/api/v1/users', () => HttpResponse.json(paginated([]))));

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/staff?page=2'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Users with access to this school' });
    await user.click(screen.getByRole('combobox', { name: 'Rows per page' }));
    // Option labels render in the tenant's own region digits (Bengali
    // numerals here), independent of the `en` UI locale.
    await user.click(await screen.findByRole('option', { name: '২০' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ limit: 20, page: 1 }));
  });

  // [8.14.10]: `GET /users` now accepts a `sort`/`order` param — clicking
  // the sortable "Name" column header writes it, replacing the old no-op
  // `onSortingChange`.
  it('clicking the Name column header writes sort/order to the URL', async () => {
    server.use(http.get('/api/v1/users', () => HttpResponse.json(paginated([]))));

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Users with access to this school' });
    await user.click(screen.getByRole('button', { name: 'Name' }));

    await waitFor(() => {
      const search = router.state.location.search as Record<string, unknown>;
      expect(search.sort).toBe('name');
      expect(['asc', 'desc']).toContain(search.order);
    });
  });

  // [8.14.10]: the hand-rolled role `Select` is now a `FilterBar` select
  // descriptor — picking a role still writes `role` to the URL.
  it('picking a role from the FilterBar filters the request', async () => {
    let requestedRole: string | null = null;
    server.use(
      http.get('/api/v1/users', ({ request }) => {
        requestedRole = new URL(request.url).searchParams.get('role');
        return HttpResponse.json(paginated([]));
      }),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Users with access to this school' });
    await user.click(screen.getByRole('combobox', { name: 'Filter by role' }));
    await user.click(await screen.findByRole('option', { name: 'Teacher' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ role: 'TEACHER' }));
    await waitFor(() => expect(requestedRole).toBe('TEACHER'));
  });
});
