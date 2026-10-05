import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, paginate, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

describe('/attendance/staff', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders a row per staff member with a staff profile, no console error', async () => {
    server.use(
      http.get('/api/v1/users', ({ request }) =>
        HttpResponse.json(
          paginate(
            [
              {
                id: 'user-1',
                full_name: 'Karim',
                email: 'karim@example.com',
                phone: null,
                role: 'TEACHER',
                status: 'ACTIVE',
                staff_profile_id: 'profile-1',
              },
            ],
            request.url,
          ),
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByRole('button', { name: 'Karim' })).toBeTruthy();
  });

  it('shows an empty state when there is no staff with a profile yet', async () => {
    server.use(
      http.get('/api/v1/users', ({ request }) => HttpResponse.json(paginate([], request.url))),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/staff'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('No staff yet')).toBeTruthy();
  });

  describe('page chrome', () => {
    function twoStaff() {
      return http.get('/api/v1/users', ({ request }) =>
        HttpResponse.json(
          paginate(
            [1, 2].map((n) => ({
              id: `user-${n}`,
              full_name: n === 1 ? 'Karim' : 'Rahima',
              email: `u${n}@example.com`,
              phone: null,
              role: 'TEACHER',
              status: 'ACTIVE',
              staff_profile_id: `profile-${n}`,
            })),
            request.url,
          ),
        ),
      );
    }

    const pinEnglishRegion = http.get('/api/v1/schools/:schoolId/settings', () =>
      HttpResponse.json({ version: 1, region: REGION_BD_EN }),
    );

    function renderPage(search = '') {
      return renderWithRouter(routeTree, {
        initialEntries: [`/attendance/staff${search}`],
        tenantId: 'tenant-1',
        role: 'ADMIN',
        locale: 'en',
      });
    }

    it('shows one h1, a count, a labelled date field and a Leave link to the leave page', async () => {
      server.use(pinEnglishRegion, twoStaff());
      const { localeReady } = renderPage('?date=2026-10-04');
      await localeReady;

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Staff attendance' }),
      ).toBeTruthy();
      expect(await screen.findByText('2 staff members')).toBeTruthy();
      // The trigger shows the long date and is named "Date" (not the ISO text).
      expect(await screen.findByText('4th October, 2026')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Date' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Leave' }).getAttribute('href')).toBe(
        '/attendance/staff/leave',
      );
    });

    it('falls back to today instead of crashing on a malformed ?date=', async () => {
      server.use(pinEnglishRegion, twoStaff());
      const { localeReady } = renderPage('?date=2026-13-45');
      await localeReady;

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Staff attendance' }),
      ).toBeTruthy();
      expect(await screen.findByRole('button', { name: 'Karim' })).toBeTruthy();
    });

    it('writes an ISO date to the URL when a day is picked', async () => {
      server.use(pinEnglishRegion, twoStaff());
      const user = userEvent.setup();
      const { router, localeReady } = renderPage('?date=2026-10-04');
      await localeReady;

      await user.click(await screen.findByRole('button', { name: 'Date' }));
      await user.click(document.querySelector('[data-date="2026-10-10"]') as HTMLElement);

      await waitFor(() =>
        expect((router.state.location.search as { date?: string }).date).toBe('2026-10-10'),
      );
    });

    it('updates the count badges and the save bar as rows are marked, and shows Saved after saving', async () => {
      server.use(
        pinEnglishRegion,
        twoStaff(),
        http.put('/api/v1/staff-attendance/register', () => HttpResponse.json({ saved: 1 })),
      );
      const user = userEvent.setup();
      const { localeReady } = renderPage();
      await localeReady;

      const save = await screen.findByRole<HTMLButtonElement>('button', {
        name: 'Save attendance',
      });
      expect(screen.getByText('Present 0')).toBeTruthy();
      expect(screen.getByText('2 unmarked')).toBeTruthy();
      expect(save.disabled).toBe(true);
      // The save bar sits in the content column, not fixed over the sidebar.
      expect((save.parentElement as HTMLElement).className).toContain('sticky');
      expect((save.parentElement as HTMLElement).className).not.toContain('fixed');

      await user.click(screen.getByRole('button', { name: 'Karim' }));
      expect(await screen.findByText('Present 1')).toBeTruthy();
      expect(screen.getByText('1 unmarked')).toBeTruthy();

      await user.click(save);
      expect(await screen.findByText('Attendance saved')).toBeTruthy();
    });
  });
});
