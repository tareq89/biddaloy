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

    await waitFor(() => expect(screen.getByText('Abdul Karim')).toBeTruthy());
    expect(screen.getByRole('tab', { name: 'Information', selected: true })).toBeTruthy();
    await screen.findByText('+880 1712-345678');
    expect(screen.getByText('karim@example.com')).toBeTruthy();
    // The greyscale guarantee (`StatusBadge`'s own spec) is what proves
    // "not colour alone" — this just proves the label renders, twice:
    // once in the header's own `statusBadge`, once in the Information
    // tab's own primary-contact field.
    expect(screen.getAllByText('Primary')).toHaveLength(2);
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

    const link = await screen.findByRole('link', { name: 'Karim Rahman' });
    expect(link.getAttribute('href')).toBe('/students/student-1');
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

    // The existing link is pre-seeded into edit mode...
    const selected = await screen.findByRole('list', { name: 'Linked students' });
    expect(within(selected).getByText('Karim Rahman')).toBeTruthy();

    // ...and the new one is added via search.
    await user.type(screen.getByRole('textbox', { name: 'Search students' }), 'Fatima');
    await user.click(await screen.findByRole('checkbox', { name: /Fatima Begum/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchedBody?.student_ids).toEqual(['student-1', 'student-2']));
    await screen.findByText('Fatima Begum');
  });

  it('Communication History tab shows the message log', async () => {
    const guardian = guardianFactory({ id: 'guardian-1' });
    server.use(
      http.get('/api/v1/guardians/:id', () => HttpResponse.json(guardian)),
      http.get('/api/v1/communications/guardian/:guardianId', () =>
        HttpResponse.json([communicationFactory({ recipient_name: 'Abdul Karim' })]),
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

    await waitFor(() => expect(screen.getByText('Abdul Karim')).toBeTruthy());
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

    const link = await screen.findByRole('link', { name: 'Karim Rahman' });
    expect(link.getAttribute('href')).toBe('/students/student-1');
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
    await waitFor(() => expect(screen.getByText('Abdul Karim Updated')).toBeTruthy());
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

    await screen.findByText('Abdul Karim');
    await expect(container).toHaveNoViolations();
  });
});
