import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** [27.8] The public status-check route. `POST /public/admission/:slug/
 * status` takes both the reference number and the guardian phone as a
 * second factor (D-A). */
describe('/admission/$slug/status public status check', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows PENDING status for a known reference number and phone', async () => {
    let requestBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/public/admission/:slug/status', async ({ request }) => {
        requestBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          status: 'PENDING',
          applicant_name: 'Rahim Ahmed',
          intake_title: 'Class 1, 2026',
        });
      }),
    );

    const user = userEvent.setup();
    renderWithRouter(routeTree, { initialEntries: ['/admission/a-school/status'], locale: 'en' });

    await waitFor(() => expect(screen.getByLabelText('Your reference number')).toBeTruthy());
    await user.type(screen.getByLabelText('Your reference number'), 'ADM-2026-000001');
    await user.type(
      screen.getByLabelText("Parent/guardian's phone number (the one you gave on the form)"),
      '01700000000',
    );
    await user.click(screen.getByRole('button', { name: 'Check status' }));

    await waitFor(() =>
      expect(screen.getByText('Your application is being reviewed')).toBeTruthy(),
    );
    expect(screen.getByText('Rahim Ahmed')).toBeTruthy();
    expect(requestBody).toEqual({
      reference_number: 'ADM-2026-000001',
      guardian_phone: '01700000000',
    });
  });

  it('shows a not-found message for an unknown reference number or wrong phone', async () => {
    server.use(
      http.post(
        '/api/v1/public/admission/:slug/status',
        () =>
          new HttpResponse(
            JSON.stringify({
              statusCode: 404,
              message: 'Application not found',
              timestamp: new Date().toISOString(),
              path: '/api/v1/public/admission/a-school/status',
              requestId: 'req-1',
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

    const user = userEvent.setup();
    renderWithRouter(routeTree, { initialEntries: ['/admission/a-school/status'], locale: 'en' });

    await waitFor(() => expect(screen.getByLabelText('Your reference number')).toBeTruthy());
    await user.type(screen.getByLabelText('Your reference number'), 'bad-ref');
    await user.type(
      screen.getByLabelText("Parent/guardian's phone number (the one you gave on the form)"),
      '01700000000',
    );
    await user.click(screen.getByRole('button', { name: 'Check status' }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "We couldn't find an application with this reference number and phone number. Please check both and try again.",
        ),
      ).toBeTruthy(),
    );
  });
});
