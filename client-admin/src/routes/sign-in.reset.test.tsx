import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../routeTree.gen';

vi.mock('../cockpit-host', () => ({ isCockpitHost: () => true }));
afterEach(cleanupTestState);

describe('/sign-in/reset', () => {
  it('a mismatch stays on the page and sends nothing', async () => {
    const posted = vi.fn();
    server.use(
      authHandlers.refreshFailure,
      http.post('*/auth/cockpit/reset-password', () => {
        posted();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithRouter(routeTree, { initialEntries: ['/sign-in/reset?token=abc'], locale: 'en' });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), 'A-strong-pass1!');
    await user.type(screen.getByLabelText('Confirm password'), 'A-different-pass2!');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect((await screen.findAllByText(/match/i)).length).toBeGreaterThan(0);
    expect(posted).not.toHaveBeenCalled();
  });

  it('success sends the owner to sign-in, not into the app', async () => {
    server.use(
      authHandlers.refreshFailure,
      http.post('*/auth/cockpit/reset-password', () => new HttpResponse(null, { status: 204 })),
    );
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/sign-in/reset?token=abc'],
      locale: 'en',
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), 'A-strong-pass1!');
    await user.type(screen.getByLabelText('Confirm password'), 'A-strong-pass1!');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(await screen.findByText('Your new password is saved. Sign in with it.')).toBeTruthy();
  });

  it('no link token shows the bad-link page', async () => {
    server.use(authHandlers.refreshFailure);
    renderWithRouter(routeTree, { initialEntries: ['/sign-in/reset'], locale: 'en' });
    expect(await screen.findByText('This link does not work')).toBeTruthy();
  });
});
