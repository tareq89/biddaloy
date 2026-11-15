import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** [3329.2.03] The list's error and permission states, one sentence + one action each. */
const NEVER_SAY = /network error|timeout|token|\b40[13]\b/i;

function mountWith(status: number) {
  server.use(
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
    ),
    http.get('/api/v1/exams', () =>
      HttpResponse.json(
        { statusCode: status, message: 'x', requestId: 'r', path: '/exams', timestamp: 't' },
        { status },
      ),
    ),
  );
  renderWithRouter(routeTree, {
    initialEntries: ['/exams'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('/exams states', () => {
  afterEach(cleanupTestState);

  it('a 403 shows the permission screen with one way out', async () => {
    mountWith(403);
    await screen.findByText('You do not have permission');
    expect(screen.getByText('Ask your school admin to give you access.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to dashboard' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(NEVER_SAY);
  });

  it('a failed load shows the error screen with Try again', async () => {
    mountWith(500);
    await screen.findByText('Something went wrong');
    expect(screen.getByText('Nothing was lost. Try again in a moment.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(NEVER_SAY);
  });
});
