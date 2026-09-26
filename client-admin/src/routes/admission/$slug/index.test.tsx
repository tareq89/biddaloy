import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const INTAKE = {
  id: 'intake-1',
  title: 'Class 1, 2026',
  seat_count: 30,
  open_date: '2026-01-01',
  close_date: '2026-12-31',
  required_document_types: ['PHOTO'],
};

/** [27.8] Public, no-login form — same "no auth call, `renderWithRouter`
 * with no session" shape as `client-admin/src/routes/i/$token.test.tsx`. */
describe('/admission/$slug public form', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the form for an open intake and submits, showing the reference number', async () => {
    server.use(
      http.get('/api/v1/public/admission/:slug', () => HttpResponse.json([INTAKE])),
      http.post('/api/v1/public/admission/:slug/applicants', () =>
        HttpResponse.json({ reference_number: 'ADM-2026-000001', status: 'PENDING' }),
      ),
    );

    const user = userEvent.setup();
    renderWithRouter(routeTree, { initialEntries: ['/admission/a-school'], locale: 'en' });

    await waitFor(() => expect(screen.getByLabelText("Student's full name")).toBeTruthy());

    await user.type(screen.getByLabelText("Student's full name"), 'Rahim Ahmed');
    await user.type(screen.getByLabelText("Student's date of birth"), '2015-05-01');
    await user.selectOptions(screen.getByLabelText("Student's gender"), 'MALE');
    await user.type(screen.getByLabelText("Parent/guardian's name"), 'Karim Ahmed');
    await user.type(screen.getByLabelText("Parent/guardian's phone number"), '1712345678');

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText("Student's photo"), file);

    await user.click(screen.getByRole('button', { name: 'Submit application' }));

    await waitFor(() => expect(screen.getByTestId('reference-number')).toBeTruthy());
    expect(within(screen.getByTestId('reference-number')).getByText('ADM-2026-000001')).toBeTruthy();
  });

  it('shows a school-not-found message for an unknown slug', async () => {
    server.use(
      http.get(
        '/api/v1/public/admission/:slug',
        () =>
          new HttpResponse(
            JSON.stringify({
              statusCode: 404,
              message: 'School not found',
              timestamp: new Date().toISOString(),
              path: '/api/v1/public/admission/unknown',
              requestId: 'req-1',
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    renderWithRouter(routeTree, { initialEntries: ['/admission/unknown'], locale: 'en' });

    await waitFor(() =>
      expect(
        screen.getByText("We couldn't find this school. Please check the link and try again."),
      ).toBeTruthy(),
    );
  });

  it('shows a no-open-intakes message when the school has none open', async () => {
    server.use(http.get('/api/v1/public/admission/:slug', () => HttpResponse.json([])));

    renderWithRouter(routeTree, { initialEntries: ['/admission/a-school'], locale: 'en' });

    await waitFor(() =>
      expect(screen.getByText("This school isn't accepting new applications right now.")).toBeTruthy(),
    );
  });
});
