import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

/** [31.5.1a] The one-shot landing flags the Ctrl+K palette navigates to: each
 * opens its dialog for a permitted role and is cleared (alone) on close. */
const ROWS = [
  { url: '/academic-years?new=1', flag: 'new' },
  { url: '/classes?new=1', flag: 'new' },
  { url: '/calendar?panel=clone', flag: 'panel' },
  { url: '/fee-structures?new=1', flag: 'new' },
  { url: '/guardians?invite=1', flag: 'invite' },
  { url: '/staff?new=1', flag: 'new' },
  { url: '/staff?promote=1', flag: 'promote' },
  { url: '/grading-scales?new=1', flag: 'new' },
  { url: '/exams/templates?new=1', flag: 'new' },
  { url: '/students?photos=1', flag: 'photos' },
];

describe('palette landing flags', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  // Every page behind these flags only needs empty lists to render.
  beforeEach(() => {
    server.use(
      http.get('/api/v1/designations', () => HttpResponse.json([])),
      http.get('/api/v1/*', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 }),
      ),
    );
  });

  it.each(ROWS)('$url opens its dialog and clears $flag on close', async ({ url, flag }) => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routeTree, {
      initialEntries: [url],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    // `All`: the staff promote dialog renders a nested dialog role alongside its own.
    await screen.findAllByRole('dialog');

    // Retried: the dialog may not hold focus yet on the first Escape.
    await waitFor(async () => {
      await user.keyboard('{Escape}');
      expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    });
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty(flag));
  });

  it('closes the dialog when Back drops the flag', async () => {
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/academic-years', '/academic-years?new=1'],
      initialIndex: 1,
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByRole('dialog');

    router.history.back();
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('new'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps a button-opened dialog open when other search params change', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/academic-years'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await user.click(await screen.findByRole('button', { name: 'Add academic year' }));
    await screen.findByRole('dialog');

    await router.navigate({ to: '/academic-years', search: { page: 2 } as never });
    await waitFor(() => expect(router.state.location.search).toHaveProperty('page', 2));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('opens nothing for a role without the gate', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/guardians?invite=1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
