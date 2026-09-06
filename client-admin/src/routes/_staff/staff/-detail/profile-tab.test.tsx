import {
  cleanupTestState,
  renderWithProviders,
  server,
  userResponseFactory,
} from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { ProfileTab } from './profile-tab';

afterEach(async () => {
  await cleanupTestState();
});

// [12.7] Verified/unverified labels next to each contact — this suite's
// whole reason to exist; `InvitationCard`/teacher-profile rendering is
// already covered by the neighboring specs in this directory.
describe('ProfileTab contact verification labels', () => {
  it('shows a verified label with the date for a verified email', async () => {
    server.use(
      http.get('/api/v1/users/:id', () =>
        HttpResponse.json(
          userResponseFactory({
            id: 'user-1',
            email: 'karim@example.com',
            email_verified_at: '2026-01-15T00:00:00.000Z',
            phone: null,
            phone_verified_at: null,
          }),
        ),
      ),
      http.get('/api/v1/teachers', ({ request }) =>
        HttpResponse.json({
          data: [],
          total: 0,
          page: 1,
          limit: 1,
          totalPages: 0,
          url: request.url,
        }),
      ),
    );

    renderWithProviders(<ProfileTab userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    expect(await screen.findByText('karim@example.com')).toBeTruthy();
    // The whole label, date included — a bare /Verified/ would still pass if
    // the `{{date}}` interpolation were dropped, which is the one thing this
    // assertion exists to catch. Matched as a shape rather than a literal so
    // it does not depend on the runner's timezone.
    //
    // The digits are Bengali (`২০২৬-০১-১৫`) even under `locale: 'en'`:
    // `formatDate` renders them through the REGION config's numeral system,
    // which is independent of the message locale. Hence both digit classes.
    expect(await screen.findByText(/^Verified [\d০-৯]{4}-[\d০-৯]{2}-[\d০-৯]{2}$/)).toBeTruthy();
  });

  it('shows an unverified label for an unverified phone', async () => {
    server.use(
      http.get('/api/v1/users/:id', () =>
        HttpResponse.json(
          userResponseFactory({
            id: 'user-2',
            email: null,
            email_verified_at: null,
            phone: '+8801711111111',
            phone_verified_at: null,
          }),
        ),
      ),
      http.get('/api/v1/teachers', ({ request }) =>
        HttpResponse.json({
          data: [],
          total: 0,
          page: 1,
          limit: 1,
          totalPages: 0,
          url: request.url,
        }),
      ),
    );

    renderWithProviders(<ProfileTab userId="user-2" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    expect(await screen.findByText('Unverified')).toBeTruthy();
  });
});
