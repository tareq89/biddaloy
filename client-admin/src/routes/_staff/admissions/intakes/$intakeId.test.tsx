import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

describe('/admissions/intakes/$intakeId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function render() {
    return renderWithRouter(routeTree, {
      initialEntries: ['/admissions/intakes/intake-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
  }

  it('shows a not-found state with a way back, and no retry, on 404 [2598]', async () => {
    server.use(
      http.get('/api/v1/admission-intakes/:id', () =>
        HttpResponse.json(apiErrorBody(404, 'x', '/api/v1/x'), { status: 404 }),
      ),
      // "Go back" lands on the intakes list, whose loader fetches this. Unhandled, MSW
      // turns it into a network error the router warns about with the whole Axios
      // error object, and inspecting it after the test tears jsdom down crashes vitest.
      http.get('/api/v1/admission-intakes', () => HttpResponse.json([])),
    );
    const { router } = render();

    expect(
      await screen.findByText('It may have been deleted, or the link may be wrong.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retry|try again/i })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Go back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/admissions/intakes'));
  });

  it('keeps the retry state on a non-404 error [2598]', async () => {
    server.use(
      http.get('/api/v1/admission-intakes/:id', () =>
        HttpResponse.json(apiErrorBody(409, 'x', '/api/v1/x'), { status: 409 }),
      ),
    );
    render();

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('It may have been deleted, or the link may be wrong.')).toBeNull();
  });
});
