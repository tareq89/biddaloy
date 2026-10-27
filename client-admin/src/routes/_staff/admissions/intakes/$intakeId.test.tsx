import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
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

  const intake = (status: 'OPEN' | 'CLOSED', close_date = '2026-02-20') => ({
    id: 'intake-1',
    title: 'Class 5 intake 2026',
    class_section_id: 'section-1',
    seat_count: 30,
    open_date: '2026-01-10',
    close_date,
    required_document_types: [],
    status,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  });

  function mockDetail(
    getIntake: () => ReturnType<typeof intake> | Promise<ReturnType<typeof intake>>,
  ) {
    server.use(
      http.get('/api/v1/admission-intakes/:id', async () => HttpResponse.json(await getIntake())),
      http.get('/api/v1/admission-applicants', () => HttpResponse.json([])),
      http.get('/api/v1/admission-intakes', () => HttpResponse.json([])),
    );
  }

  it('closes an open intake after confirm and then shows Closed', async () => {
    let current = intake('OPEN');
    let patched = false;
    let saved: { close_date?: string } | null = null;
    // Hold the refetch after the close until the end (a latch, not a timer): the page
    // must already show the closed intake from the close reply alone.
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    mockDetail(async () => {
      if (patched) await held;
      return current;
    });
    server.use(
      http.patch('/api/v1/admission-intakes/intake-1/close', () => {
        patched = true;
        current = intake('CLOSED', '2026-01-31');
        return HttpResponse.json(current);
      }),
      http.patch('/api/v1/admission-intakes/intake-1', async ({ request }) => {
        saved = (await request.json()) as { close_date?: string };
        return HttpResponse.json(current);
      }),
    );
    render();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Close now' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Close now' }));

    await waitFor(() => expect(patched).toBe(true));
    expect(await screen.findByText('Closed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close now' })).toBeNull();

    // The form re-seeds from the closed intake, so a later Save keeps it closed
    // instead of sending the old (open) close date back.
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved?.close_date).toBe('2026-01-31'));
    release();
  });

  it('shows no Close now button for a closed intake', async () => {
    mockDetail(() => intake('CLOSED'));
    render();

    expect(await screen.findByText('Closed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close now' })).toBeNull();
  });
});
