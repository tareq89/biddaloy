import { academicYearFactory, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * [8.11.1]'s detail page — real `DetailShell`/`useDetailShellTab` against
 * the real route tree, same reasoning `students/$studentId.test.tsx`'s
 * own header comment.
 */
describe('/academic-years/$academicYearId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('deep-links via ?tab= — opening straight at ?tab=statistics shows the Statistics tab, not Classes', async () => {
    const year = academicYearFactory({ id: 'year-1' });
    server.use(
      http.get('/api/v1/academic-years/:id', () => HttpResponse.json(year)),
      http.get('/api/v1/academic-years/:id/stats', () =>
        HttpResponse.json({ classes_count: 2, students_count: 30, fee_structures_count: 3 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years/year-1?tab=statistics'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Statistics', selected: true })).toBeTruthy(),
    );
  });

  it('the Statistics tab shows classes/students/fee-structure counts', async () => {
    const year = academicYearFactory({ id: 'year-1' });
    server.use(
      http.get('/api/v1/academic-years/:id', () => HttpResponse.json(year)),
      http.get('/api/v1/academic-years/:id/stats', () =>
        HttpResponse.json({ classes_count: 4, students_count: 120, fee_structures_count: 6 }),
      ),
      // Counts render through `formatNumber(count, regionConfig)` — override
      // the tenant's region settings to Latin numerals so this test's plain
      // digit assertions test "are the right counts shown", not numeral-system
      // formatting (`number.spec.ts`/`region-config.spec.ts` already own that).
      http.get('/api/v1/schools/:id/settings', () =>
        HttpResponse.json({ version: 1, region: { numerals: 'latin' } }),
      ),
    );

    const { localeReady } = renderWithRouter(routeTree, {
      initialEntries: ['/academic-years/year-1?tab=statistics'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await localeReady;

    await screen.findByText('4');
    expect(screen.getByText('120')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
  });

  it('renders Edit/Set current/Delete for ADMIN, who holds ACADEMIC_YEAR_MANAGE', async () => {
    const year = academicYearFactory({ id: 'year-1', is_current: false });
    server.use(http.get('/api/v1/academic-years/:id', () => HttpResponse.json(year)));

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years/year-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('tab', { name: 'Classes' });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set as current' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  // [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses the whole
  // route for a TEACHER, who holds no `ACADEMIC_YEAR_MANAGE` — before
  // this ticket the route still rendered for them with these three
  // buttons hidden, a partial view [8.14.17] intentionally replaces with
  // a blanket refusal (see route-permissions.ts's own comment).
  it('refuses the whole route for TEACHER, who lacks ACADEMIC_YEAR_MANAGE', async () => {
    const year = academicYearFactory({ id: 'year-1', is_current: false });
    server.use(http.get('/api/v1/academic-years/:id', () => HttpResponse.json(year)));

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years/year-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Classes' })).toBeNull();
  });

  it('does not show Set as current for the year already marked current', async () => {
    const year = academicYearFactory({ id: 'year-1', is_current: true });
    server.use(http.get('/api/v1/academic-years/:id', () => HttpResponse.json(year)));

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years/year-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('tab', { name: 'Classes' });
    expect(screen.queryByRole('button', { name: 'Set as current' })).toBeNull();
  });

  it('deleting the year navigates back to the academic years list', async () => {
    const year = academicYearFactory({ id: 'year-1', name: 'Delete Me' });
    server.use(
      http.get('/api/v1/academic-years/:id', () => HttpResponse.json(year)),
      http.delete('/api/v1/academic-years/:id', () => new HttpResponse(null, { status: 200 })),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/academic-years/year-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/academic-years'));
  });

  it('a tab whose endpoint 403s shows a clear message instead of crashing the page', async () => {
    const year = academicYearFactory({ id: 'year-1' });
    server.use(
      http.get('/api/v1/academic-years/:id', () => HttpResponse.json(year)),
      http.get('/api/v1/academic-years/:id/stats', () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'Forbidden',
            timestamp: new Date().toISOString(),
            path: '/api/v1/academic-years/year-1/stats',
            requestId: 'req-1',
          },
          { status: 403 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years/year-1?tab=statistics'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText("You don't have permission to view this.")).toBeTruthy();
  });

  it('is axe clean', async () => {
    const year = academicYearFactory({ id: 'year-1' });
    server.use(
      http.get('/api/v1/academic-years/:id', () => HttpResponse.json(year)),
      http.get('/api/v1/academic-years/:id/stats', () =>
        HttpResponse.json({ classes_count: 1, students_count: 1, fee_structures_count: 1 }),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
    );

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/academic-years/year-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    // Waits for the (default-active) Classes tab's own fetch to settle
    // too — otherwise it resolves after this test's own assertions,
    // which React logs as an unwrapped `act()` update.
    await screen.findByText('No classes in this academic year');
    await expect(container).toHaveNoViolations();
  });
});
