import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

describe('/verify-email', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows an honest state when the link has no token', async () => {
    server.use(authHandlers.refreshFailure);

    renderWithRouter(routeTree, { initialEntries: ['/verify-email'], locale: 'en' });

    await waitFor(() =>
      expect(screen.getByText('This link is incomplete — ask for a new one.')).toBeTruthy(),
    );
  });

  it('shows the success card for a valid token', async () => {
    server.use(authHandlers.refreshFailure, authHandlers.verifyEmail);

    renderWithRouter(routeTree, {
      initialEntries: ['/verify-email?token=a-valid-verify-token'],
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByText('Your contact details have been updated.')).toBeTruthy(),
    );
    // Navigation, so a link (new tab, copy address).
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
  });

  it('shows the expired-link state for an expired/consumed token', async () => {
    server.use(authHandlers.refreshFailure, authHandlers.verifyEmailExpired);

    renderWithRouter(routeTree, {
      initialEntries: ['/verify-email?token=an-expired-verify-token'],
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByText('This link has expired or has already been used.')).toBeTruthy(),
    );
  });

  it('a failed check shows a retry button that checks again', async () => {
    let calls = 0;
    server.use(
      authHandlers.refreshFailure,
      http.post('/api/v1/auth/verify-email', () => {
        calls += 1;
        return new HttpResponse(null, { status: 500 });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/verify-email?token=a-valid-verify-token'],
      locale: 'en',
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(calls).toBe(2));
  });
  describe("a school's proposal [75.1]", () => {
    const proposal = {
      status: 'proposal',
      proposal: { from_school: 'Green Valley School', new_phone: '+88017••••998' },
    };

    // D23: Approve without a code sends one to the NEW phone ('confirm'); only 123456 applies it.
    function proposalHandler(onAction: (action: string | undefined, code?: string) => void) {
      return http.post('/api/v1/auth/verify-email', async ({ request }) => {
        const body = (await request.json()) as { action?: string; phone_code?: string };
        onAction(body.action, body.phone_code);
        if (body.action === 'approve' && !body.phone_code) {
          return HttpResponse.json({ status: 'confirm' });
        }
        if (body.action === 'approve' && body.phone_code === '123456') {
          return HttpResponse.json({ status: 'valid' });
        }
        if (body.action === 'approve') {
          return HttpResponse.json(
            { statusCode: 400, message: 'Invalid or expired code' },
            { status: 400 },
          );
        }
        if (body.action === 'decline') return HttpResponse.json({ status: 'declined' });
        return HttpResponse.json(proposal);
      });
    }

    it('opening the link only shows the school and the masked value: nothing is approved', async () => {
      const actions: Array<string | undefined> = [];
      server.use(
        authHandlers.refreshFailure,
        proposalHandler((a) => actions.push(a)),
      );

      renderWithRouter(routeTree, {
        initialEntries: ['/verify-email?token=a-proposal-token'],
        locale: 'en',
      });

      expect(
        await screen.findByText('Green Valley School wants to change your contact details'),
      ).toBeTruthy();
      expect(screen.getByText('New phone: +88017••••998')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
      expect(actions).toEqual([undefined]);
    });

    it('Approve asks for the code sent to the new phone; only the right code applies the change', async () => {
      const calls: Array<[string | undefined, string | undefined]> = [];
      server.use(
        authHandlers.refreshFailure,
        proposalHandler((a, c) => calls.push([a, c])),
      );
      renderWithRouter(routeTree, {
        initialEntries: ['/verify-email?token=a-proposal-token'],
        locale: 'en',
      });
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Approve' }));

      const field = await screen.findByLabelText('Code sent to +88017••••998');
      expect(screen.queryByText('Your contact details have been updated.')).toBeNull();
      await user.type(field, '999999');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));
      expect(await screen.findByRole('alert')).toBeTruthy();

      await user.clear(field);
      await user.type(field, '123456');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));

      expect(await screen.findByText('Your contact details have been updated.')).toBeTruthy();
      expect(calls).toEqual([
        [undefined, undefined],
        ['approve', undefined],
        ['approve', '999999'],
        ['approve', '123456'],
      ]);
    });

    it('a person who never got the code can still decline', async () => {
      server.use(
        authHandlers.refreshFailure,
        proposalHandler(() => {}),
      );
      renderWithRouter(routeTree, {
        initialEntries: ['/verify-email?token=a-proposal-token'],
        locale: 'en',
      });
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Approve' }));
      await screen.findByLabelText('Code sent to +88017••••998');
      await user.click(screen.getByRole('button', { name: 'Decline' }));

      expect(
        await screen.findByText(
          'Declined. Nothing was changed, and Green Valley School has been told.',
        ),
      ).toBeTruthy();
    });

    it('Decline cancels it and says nothing changed', async () => {
      const actions: Array<string | undefined> = [];
      server.use(
        authHandlers.refreshFailure,
        proposalHandler((a) => actions.push(a)),
      );
      renderWithRouter(routeTree, {
        initialEntries: ['/verify-email?token=a-proposal-token'],
        locale: 'en',
      });
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Decline' }));

      expect(
        await screen.findByText(
          'Declined. Nothing was changed, and Green Valley School has been told.',
        ),
      ).toBeTruthy();
      expect(actions).toEqual([undefined, 'decline']);
    });
  });
});
