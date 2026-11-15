import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { CallListDialog } from './CallListDialog';

afterEach(async () => {
  await cleanupTestState();
});

describe('CallListDialog', () => {
  it('shows a tap-to-call link and saves the called tick', async () => {
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.get('/api/v1/admission/intakes/r1/call-list', () =>
        HttpResponse.json([
          {
            applicant_id: 'a1',
            name: 'Rahim',
            phone: '+8801711111111',
            roll: '7',
            called: false,
            note: null,
          },
        ]),
      ),
      http.patch('/api/v1/admission/call-list/a1', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ applicant_id: 'a1', called: true, note: null });
      }),
    );
    const root = createRootRoute();
    const tree = root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/',
        component: () => (
          <CallListDialog roundId="r1" listId="l1" open onOpenChange={() => undefined} />
        ),
      }),
    ]);
    renderWithRouter(tree, {
      initialEntries: ['/'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    const link = await screen.findByRole('link', { name: 'Call Rahim' });
    expect(link.getAttribute('href')).toBe('tel:+8801711111111');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Rahim was called' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ called: true });
  });
});
