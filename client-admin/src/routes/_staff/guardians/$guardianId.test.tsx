import {
  apiErrorBody,
  cleanupTestState,
  communicationFactory,
  guardianFactory,
  paymentFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * [8.11.4]'s full detail page — real `DetailShell`/`useDetailShellTab`
 * against the real route tree, same reasoning as `students/$studentId
 * .test.tsx`'s own header comment. Every case carries a `role` since
 * `/guardians/$guardianId` sits under `_staff`.
 */
describe('/guardians/$guardianId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the Information tab by default, with the primary-contact status not conveyed by colour alone', async () => {
    const guardian = guardianFactory({
      id: 'guardian-1',
      full_name: 'Abdul Karim',
      relationship: 'Father',
      phone: '+8801712345678',
      email: 'karim@example.com',
      is_primary_contact: true,
    });
    server.use(
      http.get('/api/v1/guardians/:id', () => HttpResponse.json(guardian)),
      // Default tenant settings' `region.phone` shape doesn't parse a
      // `+880...` number (`country: 'BD'`, not a numeral calling code) —
      // omitting `region` here falls back to the locale-derived
      // `REGION_BD_EN` default instead, whose `phone.country` is `'880'`.
      http.get('/api/v1/schools/:id/settings', () => HttpResponse.json({ version: 1 })),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Abdul Karim' })).toBeTruthy(),
    );
    expect(screen.getByRole('tab', { name: 'Information', selected: true })).toBeTruthy();
    // Phone shows in the header facts and in the Information card.
    await waitFor(() => expect(screen.getAllByText('01712-345678')).toHaveLength(2));
    expect(screen.getByText('karim@example.com')).toBeTruthy();
    // Header facts: relationship is a translated label, not the stored value.
    expect(screen.getByText('Father')).toBeTruthy();
    // No underlined back link any more (the layout's crumbs do that job).
    expect(screen.queryByRole('link', { name: 'Back to guardians' })).toBeNull();
    // The greyscale guarantee (`StatusBadge`'s own spec) is what proves
    // "not colour alone" — this just proves the label renders in the header.
    expect(screen.getAllByText('Primary')).toHaveLength(1);
  });

  it('deep-links via ?tab= — opening straight at ?tab=payments shows the Payment History tab', async () => {
    const guardian = guardianFactory({ id: 'guardian-1' });
    server.use(
      http.get('/api/v1/guardians/:id', () => HttpResponse.json(guardian)),
      http.get('/api/v1/payments/guardian/:guardianId', () => HttpResponse.json([])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1?tab=payments'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Payment History', selected: true })).toBeTruthy(),
    );
  });

  it("Linked Students tab links each row to that student's own page", async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Karim Rahman' });
    const guardian = guardianFactory({ id: 'guardian-1', students: [student] });
    server.use(http.get('/api/v1/guardians/:id', () => HttpResponse.json(guardian)));

    renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Linked Students' }));

    const row = (await screen.findByText('Karim Rahman')).closest('tr') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'View' }).getAttribute('href')).toBe(
      '/students/student-1',
    );
  });

  it('Linked Students tab shows a placeholder when nothing is linked yet', async () => {
    const guardian = guardianFactory({ id: 'guardian-1', students: [] });
    server.use(http.get('/api/v1/guardians/:id', () => HttpResponse.json(guardian)));

    renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Linked Students' }));

    expect(await screen.findByText('No students linked yet.')).toBeTruthy();
    expect(screen.getByText('Linked students will show up here.')).toBeTruthy();
  });

  it('Linked Students tab edit mode replaces student_ids via useUpdateGuardian', async () => {
    const existingStudent = studentFactory({ id: 'student-1', full_name: 'Karim Rahman' });
    const newStudent = studentFactory({ id: 'student-2', full_name: 'Fatima Begum' });
    let currentGuardian = guardianFactory({ id: 'guardian-1', students: [existingStudent] });
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      http.get('/api/v1/guardians/:id', () => HttpResponse.json(currentGuardian)),
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [newStudent], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
      http.patch('/api/v1/guardians/:id', async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        currentGuardian = { ...currentGuardian, students: [existingStudent, newStudent] };
        return HttpResponse.json(currentGuardian);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Linked Students' }));
    await user.click(await screen.findByRole('button', { name: 'Edit linked students' }));

    // The edit opens in a dialog, pre-seeded with the existing link...
    const dialog = await screen.findByRole('dialog', { name: 'Edit linked students' });
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeTruthy();
    const selected = await within(dialog).findByRole('list', { name: 'Linked students' });
    expect(within(selected).getByText('Karim Rahman')).toBeTruthy();

    // ...and the new one is added via search.
    await user.type(screen.getByRole('textbox', { name: 'Search students' }), 'Fatima');
    await user.click(await screen.findByRole('checkbox', { name: /Fatima Begum/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchedBody?.student_ids).toEqual(['student-1', 'student-2']));
    await screen.findByText('Fatima Begum');
    expect(screen.queryByRole('dialog', { name: 'Edit linked students' })).toBeNull();
  });

  it('Communication History tab shows the message log', async () => {
    const guardian = guardianFactory({ id: 'guardian-1' });
    server.use(
      http.get('/api/v1/guardians/:id', () => HttpResponse.json(guardian)),
      http.get('/api/v1/communications/guardian/:guardianId', () =>
        HttpResponse.json([
          communicationFactory({ recipient_name: 'Abdul Karim', medium: 'EMAIL' }),
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Communication History' }));

    await waitFor(() => expect(screen.getAllByText('Abdul Karim').length).toBeGreaterThan(0));
    const row = screen
      .getAllByText('Abdul Karim')
      .map((el) => el.closest('tr'))
      .find(Boolean);
    // Translated medium and status, not the raw `EMAIL` / `SENT` enums.
    expect(within(row as HTMLElement).getByText('Email')).toBeTruthy();
    expect(within(row as HTMLElement).getByText('Sent')).toBeTruthy();
    expect(screen.queryByText('EMAIL')).toBeNull();
    expect(screen.queryByText('SENT')).toBeNull();
  });

  it('Payment History tab shows a payment linking to the paying student', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Karim Rahman' });
    const guardian = guardianFactory({ id: 'guardian-1', students: [student] });
    const payment = paymentFactory({ id: 'payment-1', student, total_amount: 1500 });
    server.use(
      http.get('/api/v1/guardians/:id', () => HttpResponse.json(guardian)),
      http.get('/api/v1/payments/guardian/:guardianId', () => HttpResponse.json([payment])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Payment History' }));

    const row = (await screen.findByText('Karim Rahman')).closest('tr') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'View payment' }).getAttribute('href')).toBe(
      '/payments/payment-1',
    );
    // Method is its translated label, not the raw `CASH` enum.
    expect(within(row).getByText('Cash')).toBeTruthy();
    expect(screen.queryByText('CASH')).toBeNull();
    // Recording moved to the page header: no record button inside the tab.
    expect(screen.getAllByRole('button', { name: 'Record payment' })).toHaveLength(1);
  });

  it('Payment History tab shows the empty state with an explanation', async () => {
    server.use(
      http.get('/api/v1/guardians/:id', () =>
        HttpResponse.json(guardianFactory({ id: 'guardian-1' })),
      ),
      http.get('/api/v1/payments/guardian/:guardianId', () => HttpResponse.json([])),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1?tab=payments'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    expect(
      await screen.findByText("Payments for this guardian's children will show up here."),
    ).toBeTruthy();
  });

  it('header has one filled Record payment button that opens payments with the guardian preselected', async () => {
    server.use(
      http.get('/api/v1/guardians/:id', () =>
        HttpResponse.json(guardianFactory({ id: 'guardian-1' })),
      ),
      http.get('/api/v1/payments/guardian/:guardianId', () => HttpResponse.json([])),
    );
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const record = await screen.findByRole('button', { name: 'Record payment' });
    expect(record.getAttribute('data-variant')).toBe('default');
    // The Edit action next to it is not filled.
    expect(screen.getByRole('button', { name: 'Edit' }).getAttribute('data-variant')).not.toBe(
      'default',
    );

    const user = userEvent.setup();
    await user.click(record);
    // [31.4] `/payments?record=1` redirects to the full-page `/payments/record`, keeping guardian_id.
    await waitFor(() => expect(router.state.location.pathname).toBe('/payments/record'));
    expect(router.state.location.search).toMatchObject({ guardian_id: 'guardian-1' });
  });

  it('without PAYMENT_RECORD the header has no Record payment button', async () => {
    server.use(
      http.get('/api/v1/guardians/:id', () =>
        HttpResponse.json(guardianFactory({ id: 'guardian-1', full_name: 'Abdul Karim' })),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Abdul Karim' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();
  });

  it('Edit opens a full-page form at ?edit=1 with labelled fields, and saving removes edit from the URL', async () => {
    const guardian = guardianFactory({ id: 'guardian-1', full_name: 'Abdul Karim' });
    server.use(
      http.get('/api/v1/guardians/:id', () => HttpResponse.json(guardian)),
      http.patch('/api/v1/guardians/:id', async ({ request }) =>
        HttpResponse.json({ ...guardian, ...((await request.json()) as object) }),
      ),
    );
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Edit guardian' })).toBeTruthy();
    expect(router.state.location.search).toMatchObject({ edit: 1 });
    // Every field has a visible label (not just a placeholder).
    for (const label of [
      /^Full name/,
      'Relationship',
      'Phone',
      'Alternate phone',
      'Email',
      'Occupation',
      'Address',
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }

    await user.type(screen.getByLabelText('Occupation'), 'Farmer');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('edit'));
    expect(screen.queryByRole('heading', { level: 1, name: 'Edit guardian' })).toBeNull();
  });

  it('Edit: Cancel with unsaved changes asks before discarding, and keeps the form on Keep editing', async () => {
    server.use(
      http.get('/api/v1/guardians/:id', () =>
        HttpResponse.json(guardianFactory({ id: 'guardian-1' })),
      ),
    );
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1?edit=1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Occupation'), 'Farmer');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('Discard your changes?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Edit guardian' })).toBeTruthy();
    expect(router.state.location.search).toMatchObject({ edit: 1 });
  });

  it('Edit saves changes through useUpdateGuardian and reflects them in the header', async () => {
    // Mutable — `useUpdateGuardian`'s `onSuccess` invalidates the detail
    // query rather than writing the response straight into the cache, so
    // the header only shows the new name once the resulting refetch hits
    // a GET handler that itself reflects the PATCH.
    let currentGuardian = guardianFactory({ id: 'guardian-1', full_name: 'Abdul Karim' });
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      http.get('/api/v1/guardians/:id', () => HttpResponse.json(currentGuardian)),
      http.patch('/api/v1/guardians/:id', async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        currentGuardian = { ...currentGuardian, ...patchedBody };
        return HttpResponse.json(currentGuardian);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    const nameInput = await screen.findByRole('textbox', { name: 'Full name' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Abdul Karim Updated');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(patchedBody?.full_name).toBe('Abdul Karim Updated'));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Abdul Karim Updated' })).toBeTruthy(),
    );
  });

  it('Edit clearing an optional field sends it as empty, not omitted, so it actually clears', async () => {
    // Regression: an earlier version omitted a blank field from the PATCH
    // body entirely, which left the old value in place server-side instead
    // of clearing it — see `-edit-guardian-dialog.tsx`'s own comment.
    const guardian = guardianFactory({
      id: 'guardian-1',
      full_name: 'Abdul Karim',
      occupation: 'Farmer',
    });
    let patchedBody: Record<string, unknown> | undefined;
    server.use(
      http.get('/api/v1/guardians/:id', () => HttpResponse.json(guardian)),
      http.patch('/api/v1/guardians/:id', async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...guardian, ...patchedBody });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    const occupationInput = await screen.findByRole('textbox', { name: 'Occupation' });
    await user.clear(occupationInput);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(patchedBody?.occupation).toBe(''));
  });

  it('Edit requires a full name and shows the mutation error on failure', async () => {
    const guardian = guardianFactory({ id: 'guardian-1', full_name: 'Abdul Karim' });
    server.use(
      http.get('/api/v1/guardians/:id', () => HttpResponse.json(guardian)),
      // A 4xx, not 5xx — `shouldRetryQuery` retries a 5xx a couple of
      // times with backoff, which would make this test wait out those
      // retries for no reason.
      http.patch('/api/v1/guardians/:id', () =>
        HttpResponse.json(apiErrorBody(409, 'nope', '/api/v1/guardians/guardian-1'), {
          status: 409,
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    const nameInput = await screen.findByRole('textbox', { name: 'Full name' });
    await user.clear(nameInput);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Full name is required.')).toBeTruthy();

    await user.type(nameInput, 'Abdul Karim');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText("Couldn't update the guardian. Try again.")).toBeTruthy();
  });

  it('shows the forbidden message for a 403', async () => {
    server.use(
      http.get('/api/v1/guardians/:id', () =>
        HttpResponse.json(apiErrorBody(403, 'Forbidden', '/api/v1/guardians/guardian-1'), {
          status: 403,
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByText("You don't have permission to view this.")).toBeTruthy(),
    );
  });

  it('is axe clean', async () => {
    const guardian = guardianFactory({ id: 'guardian-1', full_name: 'Abdul Karim' });
    server.use(http.get('/api/v1/guardians/:id', () => HttpResponse.json(guardian)));

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/guardians/guardian-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { level: 1, name: 'Abdul Karim' });
    await expect(container).toHaveNoViolations();
  });
});
