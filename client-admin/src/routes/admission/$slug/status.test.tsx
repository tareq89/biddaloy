import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** [27.8] The public status-check route. `GET /public/admission/:slug/
 * status/:referenceNumber` is sibling ticket #1042's endpoint — mocked
 * here via msw since this hook fires only once a reference number is
 * entered (see `useAdmissionStatus.ts`'s header comment). */
describe('/admission/$slug/status public status check', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows PENDING status for a known reference number', async () => {
    server.use(
      http.get('/api/v1/public/admission/:slug/status/:referenceNumber', () =>
        HttpResponse.json({
          status: 'PENDING',
          applicant_name: 'Rahim Ahmed',
          intake_title: 'Class 1, 2026',
        }),
      ),
    );

    const user = userEvent.setup();
    renderWithRouter(routeTree, { initialEntries: ['/admission/a-school/status'], locale: 'en' });

    await waitFor(() => expect(screen.getByLabelText('Your reference number')).toBeTruthy());
    await user.type(screen.getByLabelText('Your reference number'), 'ADM-2026-000001');
    await user.click(screen.getByRole('button', { name: 'Check status' }));

    await waitFor(() =>
      expect(screen.getByText('Your application is being reviewed')).toBeTruthy(),
    );
    expect(screen.getByText('Rahim Ahmed')).toBeTruthy();
  });

  it('shows a not-found message for an unknown reference number', async () => {
    server.use(
      http.get(
        '/api/v1/public/admission/:slug/status/:referenceNumber',
        () =>
          new HttpResponse(
            JSON.stringify({
              statusCode: 404,
              message: 'Not found',
              timestamp: new Date().toISOString(),
              path: '/api/v1/public/admission/a-school/status/bad-ref',
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
    await user.click(screen.getByRole('button', { name: 'Check status' }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "We couldn't find an application with this reference number. Please check the number and try again.",
        ),
      ).toBeTruthy(),
    );
  });
});
