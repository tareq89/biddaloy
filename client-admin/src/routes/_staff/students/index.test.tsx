import { cleanupTestState, renderWithRouter } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * Covers [8.9.1]'s "search params typed and validated per route" and
 * "deep links restore full page state" ACs against the real route tree —
 * not a hand-built test double, the actual `zod` schema in
 * `students/index.tsx`.
 *
 * Every case carries a staff `role` since [8.9.10]: `/students` sits under
 * the `_staff` layout, whose `RequireRole` guard sends a guardian (or a
 * visitor with no resolved role at all) somewhere else entirely.
 */
describe('/students', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('reads its initial page/filter state from the URL, not a default', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students?page=2&class_id=class-9'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(/Page 2/)).toBeTruthy());
    expect(screen.getByText(/class 9|class-9/)).toBeTruthy();
  });

  it('a non-numeric page falls back to page 1 instead of crashing', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students?page=abc'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(/Page 1/)).toBeTruthy());
  });

  it('a negative page falls back to page 1 instead of crashing', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students?page=-5'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(/Page 1/)).toBeTruthy());
  });

  it('clicking "Next page" updates the URL, not just what renders', async () => {
    const user = userEvent.setup();
    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText(/Page 1/)).toBeTruthy());
    await user.click(await screen.findByRole('link', { name: /Next page/i }));

    await waitFor(() => expect(router.state.location.searchStr).toContain('page=2'));
  });
});
