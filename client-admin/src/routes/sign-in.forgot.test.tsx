import { authHandlers, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../routeTree.gen';

vi.mock('../cockpit-host', () => ({ isCockpitHost: () => true }));
afterEach(cleanupTestState);

describe('/sign-in/forgot', () => {
  it.each(['owner@example.test', 'nobody@nowhere.test'])(
    'shows the same confirmation for %s',
    async (email) => {
      server.use(
        authHandlers.refreshFailure,
        http.post('*/auth/cockpit/forgot-password', () => new HttpResponse(null, { status: 202 })),
      );
      renderWithRouter(routeTree, { initialEntries: ['/sign-in/forgot'], locale: 'en' });
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText('Email'), `${email}{Enter}`);
      expect(
        await screen.findByText(
          'If this email belongs to an owner, a link to set a new password is on its way.',
        ),
      ).toBeTruthy();
    },
  );
});
