import { alertItemFactory, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

function render(path: string) {
  return renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role: 'PARENT',
    locale: 'en',
  });
}

describe('/portal/notifications', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the To-do tab by default for a parent', async () => {
    server.use(
      http.get('*/attention/items', () =>
        HttpResponse.json({ items: [alertItemFactory({ title: 'Fee due' })], total: 1 }),
      ),
    );
    render('/portal/notifications');

    expect(await screen.findByText('Fee due')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /To-do/, selected: true })).toBeTruthy();
  });

  it('opens History from ?tab=history', async () => {
    render('/portal/notifications?tab=history');
    expect(await screen.findByRole('tab', { name: 'History', selected: true })).toBeTruthy();
  });

  it('sends studentId from ?student_id=', async () => {
    let seen: string | null = null;
    server.use(
      http.get('*/attention/items', ({ request }) => {
        seen = new URL(request.url).searchParams.get('studentId');
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );
    render('/portal/notifications?student_id=stu-1');
    await screen.findByRole('tab', { name: /To-do/ });
    await vi.waitFor(() => expect(seen).toBe('stu-1'));
  });
});
