// [2682] A 404 on a detail page shows the "record not found" state (no retry), not a load error.
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';

const PAGES: [path: string, backTo: string][] = [
  ['/classes/x', '/classes'],
  ['/academic-years/x', '/academic-years'],
  ['/staff/x', '/staff'],
  ['/programs/x', '/programs'],
  ['/promotions/x', '/promotions'],
  ['/academics/study-plans/x', '/academics/syllabus'],
  ['/grading-scales/x', '/grading-scales'],
  ['/academics/homework/x', '/academics/homework'],
];

describe('detail pages on 404 [2682]', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it.each(PAGES)('%s offers a way back and no retry', async (path, backTo) => {
    server.use(
      http.get('/api/v1/*', () =>
        HttpResponse.json(apiErrorBody(404, 'x', '/api/v1/x'), { status: 404 }),
      ),
    );
    const { router } = renderWithRouter(routeTree, {
      initialEntries: [path],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(
      await screen.findByText('It may have been deleted, or the link may be wrong.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retry|try again/i })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(backTo));
  });
});
