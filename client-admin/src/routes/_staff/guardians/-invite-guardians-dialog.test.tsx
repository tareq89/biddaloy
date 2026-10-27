/**
 * [12.6] Invite-guardians dialog: select → preview (mandatory) → confirm
 * → progress. The one behavior that matters most: the confirm button is
 * disabled until a preview has actually run, and the preview lists both
 * `to_invite` and `skipped` entries with reasons.
 */
import {
  cleanupTestState,
  invitationHandlers,
  renderWithProviders,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InviteGuardiansDialog } from './-invite-guardians-dialog';

afterEach(async () => {
  await cleanupTestState();
});

describe('InviteGuardiansDialog', () => {
  it('confirm is disabled until the preview has run, then shows to_invite and skipped entries', async () => {
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <InviteGuardiansDialog open onOpenChange={vi.fn()} />,
      { locale: 'en', tenantId: 'tenant-1', role: 'ADMIN' },
    );
    await localeReady;

    // Advancing straight to the review step without previewing first —
    // the mandatory gate lives on Submit, not on Next.
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Check the preview to see who will be invited.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send invitations' }).hasAttribute('disabled')).toBe(
      true,
    );

    // Back to the select step to run the preview.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Preview invitations' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('2 guardian(s) will be invited — 1 skipped.')).toBeTruthy();
    expect(screen.getByText('Rahim Uddin — SMS')).toBeTruthy();
    // The channel is its translated label, not the raw `EMAIL` enum.
    expect(screen.getByText('Karim Mia — Email')).toBeTruthy();
    expect(screen.queryByText(/EMAIL/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Send invitations' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('shows the all-skipped preview when every guardian is already active', async () => {
    server.use(invitationHandlers.previewInvitationsAllSkipped);
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <InviteGuardiansDialog open onOpenChange={vi.fn()} />,
      { locale: 'en', tenantId: 'tenant-1', role: 'ADMIN' },
    );
    await localeReady;

    await user.click(screen.getByRole('button', { name: 'Preview invitations' }));
    await user.click(await screen.findByRole('button', { name: 'Next' }));

    expect(await screen.findByText('0 guardian(s) will be invited — 1 skipped.')).toBeTruthy();
  });

  it('shows the progress result after confirming dispatch', async () => {
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <InviteGuardiansDialog open onOpenChange={vi.fn()} />,
      { locale: 'en', tenantId: 'tenant-1', role: 'ADMIN' },
    );
    await localeReady;

    await user.click(screen.getByRole('button', { name: 'Preview invitations' }));
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Send invitations' }).hasAttribute('disabled'),
      ).toBe(false),
    );

    await user.click(screen.getByRole('button', { name: 'Send invitations' }));

    expect(await screen.findByText('Done — 2 sent, 0 failed, 0 skipped.')).toBeTruthy();
  });

  it('with more than 1000 guardians: shows the more-remain text, and "Next 1000" re-runs the preview with `after`', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    server.use(
      http.post('/api/v1/users/invitations/preview', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        return HttpResponse.json({
          total: 1,
          // The first slice carries a cursor; the slice asked for with `after` is the last one.
          next_after: body.after ? null : 'cursor-1',
          to_invite: [
            { guardian_id: 'g1', full_name: 'Rahim Uddin', channel: 'SMS', user_exists: false },
          ],
          skipped: [],
        });
      }),
    );
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <InviteGuardiansDialog open onOpenChange={vi.fn()} />,
      { locale: 'en', tenantId: 'tenant-1', role: 'ADMIN' },
    );
    await localeReady;

    await user.click(screen.getByRole('button', { name: 'Preview invitations' }));
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/shows the first 1000 guardians/)).toBeTruthy();

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Send invitations' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: 'Send invitations' }));
    await user.click(await screen.findByRole('button', { name: 'Next 1000' }));
    await user.click(await screen.findByRole('button', { name: 'Preview invitations' }));

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0]).toEqual({ all: true });
    expect(bodies[1]).toEqual({ all: true, after: 'cursor-1' });
  });
});
