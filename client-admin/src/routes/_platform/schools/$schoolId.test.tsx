import { UserRole } from '@biddaloy/shared';
import { toast } from '@biddaloy/ui/components';
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatDate } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * #535's school detail page — stats card, admins card (table + add-admin
 * dialog + per-row resend/revoke) and the suspend/reactivate dialog, all
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

  it('renders the school header, facts and the stats with tenant numerals', async () => {
    renderDetail();

    await screen.findByRole('heading', { name: 'Ananta School', level: 1 });
    expect(screen.getByText('Active')).toBeTruthy();
    // Facts: link name + long-form created date.
    expect(screen.getByText('Link name')).toBeTruthy();
    expect(screen.getByText(formatDate('2026-01-15', REGION_BD_BN))).toBeTruthy();
    // No tab bar, no back link, no settings link.
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Back to schools' })).toBeNull();
    expect(screen.queryByRole('link', { name: /settings/i })).toBeNull();

    // Stats card — one `<dd>` per metric from `GET /schools/:id/stats`, in
    // Bangla digits (the default region).
    await screen.findByRole('heading', { name: 'Stats' });
    expect(screen.getByText('Active users').nextElementSibling?.textContent).toBe('৪');
    expect(screen.getByText('Students').nextElementSibling?.textContent).toBe('৩০');
    expect(screen.getByText('Messages waiting to send').nextElementSibling?.textContent).toBe('২');
    expect(screen.getByText('Failed messages (last 7 days)').nextElementSibling?.textContent).toBe(
      '১',
    );
    expect(screen.getByText('Last used').nextElementSibling?.textContent).not.toBe('Never');
  });

  it('has exactly one filled button; suspend and restore live in the More menu', async () => {
    const user = userEvent.setup();
    renderDetail();

    await screen.findByRole('heading', { name: 'Ananta School', level: 1 });
    expect(screen.getAllByRole('button', { name: 'Add admin' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Suspend school' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Suspend school' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Restore data from a backup file' })).toBeTruthy();
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
    expect(screen.getByText('Last used').nextElementSibling?.textContent).toBe('Never');
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

    const pendingRow = (await screen.findByText('Fatima Rahman')).closest('tr') as HTMLElement;
    expect(within(pendingRow).getByText('Invitation pending')).toBeTruthy();
    expect(within(pendingRow).getByRole('button', { name: 'Send invitation again' })).toBeTruthy();
    expect(within(pendingRow).getByRole('button', { name: 'Cancel invitation' })).toBeTruthy();

    // ACTIVATED — the user already has a password, so there is nothing to
    // resend (`issueAndSend` would answer 409) and nothing to revoke.
    const activatedRow = screen.getByText('Karim Ahmed').closest('tr') as HTMLElement;
    expect(
      within(activatedRow).queryByRole('button', { name: 'Send invitation again' }),
    ).toBeNull();
    expect(within(activatedRow).queryByRole('button', { name: 'Cancel invitation' })).toBeNull();
  });

  it('shows the empty message when the school has no admins', async () => {
    server.use(http.get('/api/v1/schools/:id/admins', () => HttpResponse.json([])));
    renderDetail();

    expect(await screen.findByText('No admins yet.')).toBeTruthy();
    // The empty state offers its own way to add the first admin.
    expect(screen.getAllByRole('button', { name: 'Add admin' })).toHaveLength(2);
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
    let resendCount = 0;
    server.use(
      http.post('/api/v1/schools/:id/admins/:userId/resend-invitation', ({ request }) => {
        resendUrl = new URL(request.url).pathname;
        resendCount += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderDetail();

    const pendingRow = (await screen.findByText('Fatima Rahman')).closest('tr') as HTMLElement;
    await user.click(within(pendingRow).getByRole('button', { name: 'Send invitation again' }));

    await waitFor(() =>
      expect(resendUrl).toBe(
        `/api/v1/schools/${ACTIVE_SCHOOL_ID}/admins/00000000-0000-4000-8000-000000000011/resend-invitation`,
      ),
    );
    // One click sends exactly one invitation.
    expect(resendCount).toBe(1);
  });

  it('shows a translated error toast when resend fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/v1/schools/:id/admins/:userId/resend-invitation', () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    );
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    renderDetail();

    const pendingRow = (await screen.findByText('Fatima Rahman')).closest('tr') as HTMLElement;
    await user.click(within(pendingRow).getByRole('button', { name: 'Send invitation again' }));

    await waitFor(() => expect(toastSpy).toHaveBeenCalledWith('Could not resend the invitation.'));
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

    const pendingRow = (await screen.findByText('Fatima Rahman')).closest('tr') as HTMLElement;
    await user.click(within(pendingRow).getByRole('button', { name: 'Cancel invitation' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Cancel this invitation?')).toBeTruthy();
    // Nothing has been sent yet — the row button only opened the dialog.
    expect(revokeUrl).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel invitation' }));

    await waitFor(() =>
      expect(revokeUrl).toBe(
        `/api/v1/schools/${ACTIVE_SCHOOL_ID}/admins/00000000-0000-4000-8000-000000000011/invitation`,
      ),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('adds an admin from the dialog, closes it and refetches on success', async () => {
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

    await screen.findByText('Fatima Rahman');
    await user.click(screen.getByRole('button', { name: 'Add admin' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'New Admin');
    await user.type(within(dialog).getByLabelText('Email'), 'new@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Add admin' }));

    await waitFor(() => expect(posted).toEqual({ name: 'New Admin', email: 'new@example.com' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('asks before discarding typed values when the add-admin dialog is cancelled', async () => {
    const user = userEvent.setup();
    renderDetail();

    await screen.findByText('Fatima Rahman');
    await user.click(screen.getByRole('button', { name: 'Add admin' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Typed Admin');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    expect(within(dialog).getByLabelText(/^Name/)).toHaveProperty('value', 'Typed Admin');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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

    await screen.findByText('Fatima Rahman');
    await user.click(screen.getByRole('button', { name: 'Add admin' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'Contactless Admin');
    await user.click(within(dialog).getByRole('button', { name: 'Add admin' }));

    expect(await within(dialog).findAllByText('Give an email or a phone number.')).toHaveLength(2);
    expect(posted).toBe(false);
  });

  it('keeps the entered values and shows a translated error when adding fails', async () => {
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

    await screen.findByText('Fatima Rahman');
    await user.click(screen.getByRole('button', { name: 'Add admin' }));
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByLabelText(/^Name/);
    await user.type(name, 'Fatima Rahman');
    await user.type(within(dialog).getByLabelText('Email'), 'fatima@example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Add admin' }));

    expect(await within(dialog).findByText('Could not add this admin.')).toBeTruthy();
    // The raw server message is never shown, and the typed values stay.
    expect(screen.queryByText(/is already an ADMIN/)).toBeNull();
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
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Suspend school' }));

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

  it('shows the Trial card for a school with a trial, and extends it from the dialog', async () => {
    let body: unknown = null;
    server.use(
      http.get('/api/v1/schools', () =>
        HttpResponse.json([
          {
            id: ACTIVE_SCHOOL_ID,
            name: 'Ananta School',
            slug: 'ananta-school',
            status: 'ACTIVE',
            created_at: '2026-01-15T00:00:00.000Z',
            country_code: 'BD',
            trial_ends_at: '2026-01-10T00:00:00.000Z',
            seat_limit: 50,
            status_reason: null,
          },
        ]),
      ),
      http.patch(`/api/v1/schools/${ACTIVE_SCHOOL_ID}/trial`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: ACTIVE_SCHOOL_ID });
      }),
    );
    const user = userEvent.setup();
    renderDetail();

    await screen.findByRole('heading', { name: 'Trial', level: 2 });
    expect(screen.getByText('Trial ended')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Extend trial' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Days to add'), '14');
    await user.type(within(dialog).getByLabelText('Reason'), 'Asked for more time');
    await user.click(within(dialog).getByRole('button', { name: 'Extend trial' }));

    await waitFor(() => expect(body).toEqual({ days: 14, reason: 'Asked for more time' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('hides the Trial card for a school that never had a trial', async () => {
    renderDetail();
    await screen.findByRole('heading', { name: 'Ananta School', level: 1 });
    await screen.findByRole('heading', { name: 'Stats' });
    expect(screen.queryByRole('heading', { name: 'Trial' })).toBeNull();
  });
});
