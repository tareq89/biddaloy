import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * #535's school detail page — stats card, admins card (list + inline add
 * form + per-row resend/revoke) and the suspend/reactivate dialog, all
 * rendered through the real route with the shared `schools` MSW handlers.
 * Every case renders as SUPER_ADMIN; `_platform.access.test.tsx` covers
 * the role gate.
 */
const ACTIVE_SCHOOL_ID = '00000000-0000-4000-8000-000000000001'; // Ananta School
const SUSPENDED_SCHOOL_ID = '00000000-0000-4000-8000-000000000002'; // Zenith School

function renderDetail(schoolId = ACTIVE_SCHOOL_ID) {
  return renderWithRouter(routeTree, {
    initialEntries: [`/schools/${schoolId}`],
    tenantId: 'tenant-1',
    role: UserRole.SUPER_ADMIN,
    locale: 'en',
  });
}

describe('/schools/$schoolId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the school header with its status and the five stats', async () => {
    renderDetail();

    await screen.findByRole('heading', { name: 'Ananta School' });
    expect(screen.getByText('Active')).toBeTruthy();

    // Stats card — one `<dd>` per metric from `GET /schools/:id/stats`.
    await screen.findByRole('heading', { name: 'Stats' });
    expect(screen.getByText('Active users').nextElementSibling?.textContent).toBe('4');
    expect(screen.getByText('Students').nextElementSibling?.textContent).toBe('30');
    expect(screen.getByText('Communications queued').nextElementSibling?.textContent).toBe('2');
    expect(screen.getByText('Communications failed (7d)').nextElementSibling?.textContent).toBe(
      '1',
    );
    expect(screen.getByText('Last activity').nextElementSibling?.textContent).not.toBe('Never');
  });

  it('renders "Never" for a school with no activity yet', async () => {
    server.use(
      http.get('/api/v1/schools/:id/stats', () =>
        HttpResponse.json({
          active_users: 0,
          students: 0,
          communications_queued: 0,
          communications_failed_7d: 0,
          last_activity_at: null,
        }),
      ),
    );
    renderDetail();

    await screen.findByRole('heading', { name: 'Stats' });
    expect(screen.getByText('Last activity').nextElementSibling?.textContent).toBe('Never');
  });

  it('shows a retryable error in the stats card when the stats request fails', async () => {
    server.use(http.get('/api/v1/schools/:id/stats', () => HttpResponse.json({}, { status: 500 })));
    renderDetail();

    expect(await screen.findByText('Could not load stats.')).toBeTruthy();
    // The rest of the page (admins) is unaffected by the stats failure.
    await screen.findByText('Fatima Rahman');
  });

  it('lists admins, offering resend/revoke only for an actionable invitation', async () => {
    renderDetail();

    const pendingRow = (await screen.findByText('Fatima Rahman')).closest('li') as HTMLElement;
    expect(within(pendingRow).getByText('Invitation pending')).toBeTruthy();
    expect(within(pendingRow).getByRole('button', { name: 'Resend invitation' })).toBeTruthy();
    expect(within(pendingRow).getByRole('button', { name: 'Revoke invitation' })).toBeTruthy();

    // ACTIVATED — the user already has a password, so there is nothing to
    // resend (`issueAndSend` would answer 409) and nothing to revoke.
    const activatedRow = screen.getByText('Karim Ahmed').closest('li') as HTMLElement;
    expect(within(activatedRow).getByText('01712345678')).toBeTruthy();
    expect(within(activatedRow).queryByRole('button', { name: 'Resend invitation' })).toBeNull();
    expect(within(activatedRow).queryByRole('button', { name: 'Revoke invitation' })).toBeNull();
  });

  it('shows the empty message when the school has no admins', async () => {
    server.use(http.get('/api/v1/schools/:id/admins', () => HttpResponse.json([])));
    renderDetail();

    expect(await screen.findByText('No admins yet.')).toBeTruthy();
  });

  it('shows a retryable error in the admins card when the admins request fails', async () => {
    server.use(
      http.get('/api/v1/schools/:id/admins', () => HttpResponse.json({}, { status: 500 })),
    );
    renderDetail();

    expect(await screen.findByText('Could not load admins.')).toBeTruthy();
  });

  it('resends a pending invitation from its row', async () => {
    const user = userEvent.setup();
    let resendUrl: string | null = null;
    server.use(
      http.post('/api/v1/schools/:id/admins/:userId/resend-invitation', ({ request }) => {
        resendUrl = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderDetail();

    const pendingRow = (await screen.findByText('Fatima Rahman')).closest('li') as HTMLElement;
    await user.click(within(pendingRow).getByRole('button', { name: 'Resend invitation' }));

    await waitFor(() =>
      expect(resendUrl).toBe(
        `/api/v1/schools/${ACTIVE_SCHOOL_ID}/admins/00000000-0000-4000-8000-000000000011/resend-invitation`,
      ),
    );
  });

  it('shows an inline error when resend fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/v1/schools/:id/admins/:userId/resend-invitation', () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    );
    renderDetail();

    const pendingRow = (await screen.findByText('Fatima Rahman')).closest('li') as HTMLElement;
    await user.click(within(pendingRow).getByRole('button', { name: 'Resend invitation' }));

    expect(await within(pendingRow).findByRole('alert')).toBeTruthy();
    expect(within(pendingRow).getByText('Could not resend the invitation.')).toBeTruthy();
  });

  it('revokes a pending invitation only after confirming in the dialog', async () => {
    const user = userEvent.setup();
    let revokeUrl: string | null = null;
    server.use(
      http.delete('/api/v1/schools/:id/admins/:userId/invitation', ({ request }) => {
        revokeUrl = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderDetail();

    const pendingRow = (await screen.findByText('Fatima Rahman')).closest('li') as HTMLElement;
    await user.click(within(pendingRow).getByRole('button', { name: 'Revoke invitation' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/revokes the pending invitation for Fatima Rahman/),
    ).toBeTruthy();
    // Nothing has been sent yet — the row button only opened the dialog.
    expect(revokeUrl).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Revoke invitation' }));

    await waitFor(() =>
      expect(revokeUrl).toBe(
        `/api/v1/schools/${ACTIVE_SCHOOL_ID}/admins/00000000-0000-4000-8000-000000000011/invitation`,
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('adds an admin from the inline form and clears it on success', async () => {
    const user = userEvent.setup();
    let posted: unknown = null;
    server.use(
      http.post('/api/v1/schools/:id/admins', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(
          {
            user_id: 'new-user',
            name: 'New Admin',
            email: 'new@example.com',
            phone: null,
            membership_status: 'ACTIVE',
            invitation: null,
          },
          { status: 201 },
        );
      }),
    );
    renderDetail();

    await screen.findByRole('heading', { name: 'Add admin' });
    const name = screen.getByLabelText('Name');
    const email = screen.getByLabelText('Email');
    await user.type(name, 'New Admin');
    await user.type(email, 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Add admin' }));

    await waitFor(() => expect(posted).toEqual({ name: 'New Admin', email: 'new@example.com' }));
    // Success clears the form for the next admin.
    await waitFor(() => expect((name as HTMLInputElement).value).toBe(''));
    expect((email as HTMLInputElement).value).toBe('');
  });

  it('rejects an admin with neither email nor phone before sending anything', async () => {
    const user = userEvent.setup();
    let posted = false;
    server.use(
      http.post('/api/v1/schools/:id/admins', () => {
        posted = true;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    renderDetail();

    await screen.findByRole('heading', { name: 'Add admin' });
    await user.type(screen.getByLabelText('Name'), 'Contactless Admin');
    await user.click(screen.getByRole('button', { name: 'Add admin' }));

    expect(await screen.findAllByText('Provide an email or a phone number.')).toHaveLength(2);
    expect(posted).toBe(false);
  });

  it('keeps the entered values and shows the server message when adding fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/v1/schools/:id/admins', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'User "x" is already an ADMIN of this school',
            timestamp: new Date().toISOString(),
            path: '/api/v1/schools/x/admins',
            requestId: 'r1',
          },
          { status: 409 },
        ),
      ),
    );
    renderDetail();

    await screen.findByRole('heading', { name: 'Add admin' });
    const name = screen.getByLabelText('Name');
    await user.type(name, 'Fatima Rahman');
    await user.type(screen.getByLabelText('Email'), 'fatima@example.com');
    await user.click(screen.getByRole('button', { name: 'Add admin' }));

    expect(await screen.findByText('User "x" is already an ADMIN of this school')).toBeTruthy();
    // The failed submission must not wipe what the user typed.
    expect((name as HTMLInputElement).value).toBe('Fatima Rahman');
  });

  it('suspends an active school with a reason through the confirm dialog', async () => {
    const user = userEvent.setup();
    let patched: unknown = null;
    server.use(
      http.patch('/api/v1/schools/:id/status', async ({ request, params }) => {
        patched = await request.json();
        return HttpResponse.json({
          id: params.id,
          status: 'SUSPENDED',
          status_reason: 'Non-payment',
          status_changed_at: '2026-09-08T00:00:00.000Z',
        });
      }),
    );
    renderDetail();

    await screen.findByRole('heading', { name: 'Ananta School' });
    await user.click(screen.getByRole('button', { name: 'Suspend' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Suspend school' })).toBeTruthy();

    // Too short a reason is caught client-side, mirroring the DTO's
    // `Length(5, 500)` — no request goes out.
    await user.type(within(dialog).getByLabelText('Reason'), 'no');
    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    expect(patched).toBeNull();

    await user.clear(within(dialog).getByLabelText('Reason'));
    await user.type(within(dialog).getByLabelText('Reason'), 'Non-payment');
    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }));

    await waitFor(() => expect(patched).toEqual({ status: 'SUSPENDED', reason: 'Non-payment' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('offers Reactivate for a suspended school and surfaces a failed status update', async () => {
    const user = userEvent.setup();
    server.use(
      http.patch('/api/v1/schools/:id/status', () => HttpResponse.json({}, { status: 500 })),
    );
    renderDetail(SUSPENDED_SCHOOL_ID);

    await screen.findByRole('heading', { name: 'Zenith School' });
    await user.click(screen.getByRole('button', { name: 'Reactivate' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Reactivate school' })).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Reason'), 'Payment received');
    await user.click(within(dialog).getByRole('button', { name: 'Reactivate' }));

    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByText("Could not update the school's status.")).toBeTruthy();
  });

  it('shows a load error for an id that is not in the schools list', async () => {
    renderDetail('00000000-0000-4000-8000-00000000dead');

    expect(await screen.findByText('Could not load this school.')).toBeTruthy();
  });
});
