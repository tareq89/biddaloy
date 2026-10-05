import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchoolSettingsPage } from './SchoolSettingsPage';
import { SETTINGS_CATEGORY_IDS } from './settings/settings-categories';

// The page reads `useSearch({ from: '/_staff/settings' })`, so mount it under a
// route with that exact id (a `_staff` layout + `settings` child), as in the app.
function PageWithRouter({ url = '/settings' }: { url?: string }) {
  const [router] = React.useState(() => {
    const root = createRootRoute({ component: Outlet });
    const staff = createRoute({ getParentRoute: () => root, id: '_staff', component: Outlet });
    const settings = createRoute({
      getParentRoute: () => staff,
      path: 'settings',
      validateSearch: (s: Record<string, unknown>) => ({
        section: SETTINGS_CATEGORY_IDS.find((id) => id === s.section),
      }),
      component: SchoolSettingsPage,
    });
    return createRouter({
      routeTree: root.addChildren([staff.addChildren([settings])]),
      history: createMemoryHistory({ initialEntries: [url] }),
    });
  });
  return <RouterProvider router={router} />;
}

// Matches ApiErrorBody's shape — apiClient's response interceptor
// (client.ts's toApiError) only recognizes this shape as an ApiError;
// anything else falls through to a plain Error, which shouldRetryQuery
// then retries twice regardless of status code before settling isError.
function apiErrorBody(statusCode: number) {
  return {
    statusCode,
    message: 'Something went wrong.',
    timestamp: new Date().toISOString(),
    path: '/api/v1/schools',
    requestId: 'test-request-id',
  };
}

/** `decodeAccessTokenMemberships` never checks a signature (see
 * `session.ts`'s own comment) — same fake-JWT shape as `session.test.ts`. */
function fakeJwtWithMemberships(memberships: unknown): string {
  const payload = btoa(JSON.stringify({ memberships }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

const adminOwnSchool = [{ tenantId: 'tenant-1', role: 'ADMIN', name: 'Greenview School' }];

describe('SchoolSettingsPage', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows a school picker for a SUPER_ADMIN, with no school selected by default', async () => {
    renderWithProviders(<PageWithRouter />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });

    expect(await screen.findByLabelText('School')).toBeTruthy();
    // No school picked yet — the "which school" banner (the issue's own
    // "unmistakable on screen at all times" criterion) has nothing to
    // show until one is, so it stays absent rather than showing a
    // misleadingly empty/blank state.
    expect(screen.queryByRole('status', { name: /Configuring settings for/ })).toBeNull();
  });

  it('picking a school shows the school name in the subtitle and the School category', async () => {
    const { user } = renderWithProviders(<PageWithRouter />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });

    await user.click(await screen.findByLabelText('School'));
    await user.click(await screen.findByRole('option', { name: 'Ananta School' }));

    expect(await screen.findByText('Settings for Ananta School')).toBeTruthy();
    // The School category: profile, organisation, regional and calendar cards.
    for (const name of [
      'School profile',
      'Shift, version & group',
      'Language, numbers and dates',
      'Calendar',
    ]) {
      expect(await screen.findByRole('heading', { level: 2, name })).toBeTruthy();
    }
    // Other categories' sections are not rendered.
    expect(screen.queryByText('SMS')).toBeNull();
  });

  it('?section=communication shows the SMS section and not the School ones', async () => {
    renderWithProviders(<PageWithRouter url="/settings?section=communication" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
      accessToken: fakeJwtWithMemberships(adminOwnSchool),
    });

    expect(await screen.findByText('SMS')).toBeTruthy();
    expect(
      screen.queryByRole('heading', { level: 2, name: 'Language, numbers and dates' }),
    ).toBeNull();
  });

  it('an old #printers-section link opens the Printing category', async () => {
    renderWithProviders(<PageWithRouter url="/settings#printers-section" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
      accessToken: fakeJwtWithMemberships(adminOwnSchool),
    });

    const link = await screen.findByRole('link', { name: 'Printing' });
    expect(link.getAttribute('aria-current')).toBe('page');
  });

  it('does not request settings before a school is selected', async () => {
    const getSettings = vi.fn();
    server.use(
      http.get('/api/v1/schools/:id/settings', ({ params }) => {
        getSettings(params.id);
        return HttpResponse.json({ version: 1, region: {} });
      }),
    );

    renderWithProviders(<PageWithRouter />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });

    await screen.findByLabelText('School');
    // No school picked yet — useSchoolSettings('') must stay disabled
    // rather than firing a request against `/schools//settings`.
    expect(getSettings).not.toHaveBeenCalled();
  });

  it('shows an error message if the school list fails to load', async () => {
    // A 4xx, not a 5xx — shouldRetryQuery doesn't retry 4xx responses, so
    // this settles isError immediately instead of after two backoff delays.
    server.use(
      http.get('/api/v1/schools', () => HttpResponse.json(apiErrorBody(400), { status: 400 })),
    );

    renderWithProviders(<PageWithRouter />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /couldn't load the list of schools/i,
    );
  });

  it("shows an error message if the selected school's settings fail to load", async () => {
    server.use(
      http.get('/api/v1/schools/:id/settings', () =>
        HttpResponse.json(apiErrorBody(400), { status: 400 }),
      ),
    );
    const { user } = renderWithProviders(<PageWithRouter />, {
      locale: 'en',
      role: 'SUPER_ADMIN',
      tenantId: 'tenant-1',
    });

    const picker = await screen.findByLabelText('School');
    await user.click(picker);
    await user.click(await screen.findByRole('option', { name: 'Ananta School' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn't load settings/i);
  });

  it('an ADMIN sees no picker at all — their own school loads directly', async () => {
    renderWithProviders(<PageWithRouter />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
      accessToken: fakeJwtWithMemberships(adminOwnSchool),
    });

    expect(screen.queryByLabelText('School')).toBeNull();
    // Names the real school, not a raw tenant id — [8.9.5] fixed this
    // banner falling back to the UUID for a non-super-admin.
    await waitFor(() => {
      expect(screen.getByText('Settings for Greenview School')).toBeTruthy();
    });
  });

  it('has no accessibility violations on the default (School) category', async () => {
    const { container } = renderWithProviders(<PageWithRouter />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
      accessToken: fakeJwtWithMemberships(adminOwnSchool),
    });

    await screen.findByRole('heading', { level: 2, name: 'School profile' });
    await expect(container).toHaveNoViolations();
  });

  describe('curriculum preset link [35.5.2]', () => {
    function mount(role: string, state: 'APPLIED' | 'AVAILABLE') {
      server.use(
        http.get('/api/v1/presets/status', () =>
          HttpResponse.json(
            state === 'APPLIED'
              ? {
                  state,
                  preset: { id: 'nctb', version: '2025.1', appliedAt: '2026-01-01T00:00:00Z' },
                }
              : { state },
          ),
        ),
      );
      renderWithProviders(<PageWithRouter url="/settings?section=academics" />, {
        locale: 'en',
        role,
        tenantId: 'tenant-1',
        accessToken: fakeJwtWithMemberships(adminOwnSchool),
      });
    }

    it('shows "Not applied" and a link to the page when AVAILABLE', async () => {
      mount('ADMIN', 'AVAILABLE');
      expect(await screen.findByText('Not applied')).toBeTruthy();
      const link = screen.getByRole('link', { name: 'Open' });
      expect(link.getAttribute('href')).toBe('/curriculum-preset');
    });

    it('shows the preset name (never its id) and version when APPLIED', async () => {
      server.use(
        http.get('/api/v1/presets', () =>
          HttpResponse.json([
            { id: 'nctb', version: '2025.1', name: { en: 'NCTB Bangla Medium', bn: 'এনসিটিবি' } },
          ]),
        ),
      );
      mount('ADMIN', 'APPLIED');
      expect(await screen.findByText('Applied: NCTB Bangla Medium · 2025.1')).toBeTruthy();
      expect(screen.queryByText(/nctb ·/)).toBeNull();
    });

    it('is hidden without CURRICULUM_PRESET_APPLY', async () => {
      mount('TEACHER', 'AVAILABLE');
      await screen.findByText('Settings for Greenview School');
      expect(screen.queryByText('Ready-made curriculum')).toBeNull();
    });
  });
});
