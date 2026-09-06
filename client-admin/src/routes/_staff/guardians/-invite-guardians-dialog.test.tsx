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
    expect(await screen.findByText('Run the preview to see who will be invited.')).toBeTruthy();
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

    expect(await screen.findByText('Done — 2 sent, 0 failed.')).toBeTruthy();
  });
});
