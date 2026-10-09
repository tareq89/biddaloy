import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import {
  cleanupTestState,
  renderWithProviders,
  teacherFactory,
  server,
  userResponseFactory,
} from '@biddaloy/ui/test';
import { formatDate } from '@biddaloy/ui/utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    expect(await screen.findByText('Verified')).toBeTruthy();
    expect(screen.getByTitle(`Verified ${formatDate('2026-01-15', REGION_BD_BN)}`)).toBeTruthy();
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

    expect(await screen.findByText('Not verified')).toBeTruthy();
  });

  it("the teacher card's Edit button calls onEditTeacher and needs USER_UPDATE", async () => {
    const teacher = { ...teacherFactory(), designations: [] };
    server.use(
      http.get('/api/v1/users/:id', () =>
        HttpResponse.json(userResponseFactory({ id: 'user-3', email: 'a@example.com' })),
      ),
      http.get('/api/v1/teachers', () =>
        HttpResponse.json({ data: [teacher], total: 1, page: 1, limit: 1, totalPages: 1 }),
      ),
    );
    const onEditTeacher = vi.fn();

    renderWithProviders(<ProfileTab userId="user-3" onEditTeacher={onEditTeacher} />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Edit' }));
    expect(onEditTeacher).toHaveBeenCalledTimes(1);
  });

  it('hides the teacher Edit button without USER_UPDATE', async () => {
    const teacher = { ...teacherFactory(), designations: [] };
    server.use(
      http.get('/api/v1/users/:id', () =>
        HttpResponse.json(userResponseFactory({ id: 'user-3', email: 'a@example.com' })),
      ),
      http.get('/api/v1/teachers', () =>
        HttpResponse.json({ data: [teacher], total: 1, page: 1, limit: 1, totalPages: 1 }),
      ),
    );

    renderWithProviders(<ProfileTab userId="user-3" onEditTeacher={() => undefined} />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'COMMITTEE',
    });

    await screen.findByText('a@example.com');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});
