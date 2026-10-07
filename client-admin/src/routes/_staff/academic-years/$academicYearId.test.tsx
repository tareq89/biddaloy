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

  it('the header shows the stored name as the h1, the long-form period and the counts as facts', async () => {
    const year = academicYearFactory({ id: 'year-1', name: 'Session 26' });
    server.use(
      http.get('/api/v1/academic-years/:id', () => HttpResponse.json(year)),
      http.get('/api/v1/academic-years/:id/stats', () =>
        HttpResponse.json({ classes_count: 4, students_count: 120, fee_structures_count: 6 }),
      ),
      // Latin numerals so the digit assertions test "are the right counts shown";
      // numeral-system formatting is owned by number.spec.ts / region-config.spec.ts.
      http.get('/api/v1/schools/:id/settings', () =>
        HttpResponse.json({ version: 1, region: { numerals: 'latin' } }),
      ),
    );

    const { localeReady } = renderWithRouter(routeTree, {
      initialEntries: ['/academic-years/year-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await localeReady;

    expect(await screen.findByRole('heading', { level: 1, name: 'Session 26' })).toBeTruthy();
    expect(await screen.findByText('4 classes')).toBeTruthy();
    expect(screen.getByText('120 students')).toBeTruthy();
    expect(screen.getByText('6 fee structures')).toBeTruthy();
    // One long-form period (no ISO date on screen).
    expect(screen.getByText(/January.*December.*20\d\d/)).toBeTruthy();
    expect(screen.queryByText(/\d{4}-\d{2}-\d{2}/)).toBeNull();
    // The back link is gone: only the breadcrumb leads back.
    // (the breadcrumb is the one link back; the old in-page link would make it two)
    expect(
      within(screen.getByRole('main')).getAllByRole('link', { name: 'Academic Years' }),
    ).toHaveLength(1);
  });

  it('has three tabs only, and ?tab=statistics falls back to the first tab', async () => {
    const year = academicYearFactory({ id: 'year-1' });
    server.use(http.get('/api/v1/academic-years/:id', () => HttpResponse.json(year)));

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years/year-1?tab=statistics'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Classes', selected: true })).toBeTruthy(),
    );
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Classes',
      'Fee Structures',
      'Terms',
    ]);
    expect(screen.queryByRole('tab', { name: 'Statistics' })).toBeNull();
  });

  it('Edit is the only filled button, Set as current is outline, and Delete sits in More actions', async () => {
    const year = academicYearFactory({ id: 'year-1', is_current: false });
    server.use(http.get('/api/v1/academic-years/:id', () => HttpResponse.json(year)));

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years/year-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('tab', { name: 'Classes' });
    expect(screen.getByRole('button', { name: 'Edit' }).getAttribute('data-variant')).toBe(
      'default',
    );
    expect(
      screen.getByRole('button', { name: 'Set as current' }).getAttribute('data-variant'),
    ).toBe('outline');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeTruthy();
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

  it('Set as current opens a confirm dialog that warns it unsets every other year', async () => {
    const year = academicYearFactory({ id: 'year-1', name: 'Next', is_current: false });
    let called = false;
    server.use(
      http.get('/api/v1/academic-years/:id', () => HttpResponse.json(year)),
      http.post('/api/v1/academic-years/:id/set-current', () => {
        called = true;
        return HttpResponse.json({ ...year, is_current: true });
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years/year-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Set as current' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText(/unsets every other academic year/i)).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: 'Set as current' }));
    await waitFor(() => expect(called).toBe(true));
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
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText(/Delete "Delete Me"\?/)).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/academic-years'));
  });

  it('a tab whose endpoint 403s shows a clear message instead of crashing the page', async () => {
    const year = academicYearFactory({ id: 'year-1' });
    server.use(
      http.get('/api/v1/academic-years/:id', () => HttpResponse.json(year)),
      http.get('/api/v1/classes', () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'Forbidden',
            timestamp: new Date().toISOString(),
            path: '/api/v1/classes',
            requestId: 'req-1',
          },
          { status: 403 },
        ),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academic-years/year-1'],
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
