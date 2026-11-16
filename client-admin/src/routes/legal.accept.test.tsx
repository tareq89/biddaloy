import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

afterEach(async () => {
  await cleanupTestState();
});

const OPTS = { tenantId: 'tenant-1', role: UserRole.ADMIN, locale: 'en' as const };

function mockStatus(accept: () => Response) {
  let pending = ['terms', 'privacy', 'dpa'];
  server.use(
    http.get('/api/v1/legal/status', () => HttpResponse.json({ pending })),
    http.post('/api/v1/legal/accept', () => {
      const res = accept();
      if (res.ok) pending = [];
      return res;
    }),
  );
}

describe('/legal/accept', () => {
  it('button is off until ticked, then agrees and returns to the redirect', async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.post('/api/v1/legal/accept', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ pending: [] });
      }),
    );
    let pending = ['terms', 'privacy', 'dpa'];
    server.use(http.get('/api/v1/legal/status', () => HttpResponse.json({ pending })));
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/legal/accept?redirect=%2Fstudents'],
      ...OPTS,
    });
    const submit = await screen.findByRole('button', { name: 'Agree and continue' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await screen.findByRole('button', { name: 'Terms' });
    await user.click(screen.getByRole('checkbox', { name: 'I have read and agree' }));
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    pending = [];
    await user.click(submit);
    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
    expect(body).toEqual({ documents: ['terms', 'privacy', 'dpa'] });
  });

  it('keeps a submit error inline and stays on the page', async () => {
    const user = userEvent.setup();
    mockStatus(() => HttpResponse.json({ message: 'boom' }, { status: 500 }));
    const { router } = renderWithRouter(routeTree, { initialEntries: ['/legal/accept'], ...OPTS });
    await screen.findByRole('button', { name: 'Terms' });
    await user.click(screen.getByRole('checkbox', { name: 'I have read and agree' }));
    await user.click(screen.getByRole('button', { name: 'Agree and continue' }));
    expect(await screen.findByText('Your agreement was not saved. Try again.')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/legal/accept');
  });
});
