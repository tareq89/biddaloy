import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

import { CommandPaletteLauncher } from './command-palette-launcher';

/**
 * [30.5.1] `CommandPaletteLauncher` replaces the retired
 * `GlobalSearchLauncher`. Rendered through the real staff layout
 * (`_staff.tsx` mounts it in the top bar on every staff route), same
 * reasoning as every other route test in this app.
 *
 * [8.14.3]: `_staff.tsx` mounts this component twice (desktop top bar,
 * mobile header row) — `findAllByRole(...)[0]` picks the desktop
 * instance deterministically, same as the old launcher's own test did.
 */
describe('CommandPaletteLauncher', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('selecting a guardian result navigates to its own detail page', async () => {
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({
          guardians: [{ id: 'guardian-1', full_name: 'Karim Rahman', phone: '+8801700000000' }],
        }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search (Ctrl+K)' }))[0]!);
    await user.type(screen.getByRole('combobox', { name: 'Search' }), 'Karim');

    const option = await screen.findByRole('option', { name: /Karim Rahman/ });
    await user.click(option);

    await waitFor(() => expect(router.state.location.pathname).toBe('/guardians/guardian-1'));
  });

  it('selecting a student result navigates to its own detail page', async () => {
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({
          students: [
            {
              id: 'student-1',
              full_name: 'Rahim Uddin',
              registration_number: 'R-1',
              roll_number: 1,
              class_name: 'Five',
              section_name: 'A',
              matched_via: 'direct',
            },
          ],
        }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search (Ctrl+K)' }))[0]!);
    await user.type(screen.getByRole('combobox', { name: 'Search' }), 'Rahim');

    const option = await screen.findByRole('option', { name: /Rahim Uddin/ });
    await user.click(option);

    await waitFor(() => expect(router.state.location.pathname).toBe('/students/student-1'));
  });

  it('selecting a staff result closes the palette without navigating — no detail page exists', async () => {
    server.use(
      http.get('/api/v1/search', () =>
        HttpResponse.json({
          staff: [{ id: 'staff-1', full_name: 'Nasrin Akter', employee_id: 'E-1' }],
        }),
      ),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search (Ctrl+K)' }))[0]!);
    await user.type(screen.getByRole('combobox', { name: 'Search' }), 'Nasrin');

    const option = await screen.findByRole('option', { name: /Nasrin Akter/ });
    await user.click(option);

    await waitFor(() => expect(router.state.location.pathname).toBe('/students'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('`/` as the first character switches to the Page tab (D11)', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search (Ctrl+K)' }))[0]!);
    const input = screen.getByRole('combobox', { name: 'Search' });
    await user.type(input, '/');

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Page' }).getAttribute('aria-selected')).toBe('true'),
    );
    // The `/` itself was consumed as the tab switch, not query text.
    expect(input).toHaveProperty('value', '');
  });

  it('Action tab offers an action only when its permission is held', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search (Ctrl+K)' }))[0]!);
    const input = screen.getByRole('combobox', { name: 'Search' });
    await user.type(input, '>student');

    await waitFor(() => expect(screen.queryByRole('option', { name: 'Add student' })).toBeNull());
  });

  it('Action tab offers a context-free action (`context: []`) from any page', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/students'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search (Ctrl+K)' }))[0]!);
    const input = screen.getByRole('combobox', { name: 'Search' });
    await user.type(input, '>start acr');

    expect(await screen.findByRole('option', { name: 'Start ACR' })).toBeTruthy();
  });

  it('COMMITTEE (no STUDENT_READ) sees Page and Action tabs only and makes no /search call', async () => {
    let searchCalls = 0;
    server.use(
      http.get('/api/v1/search', () => {
        searchCalls += 1;
        return HttpResponse.json({});
      }),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/roles'],
      tenantId: 'tenant-1',
      role: 'COMMITTEE',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Search (Ctrl+K)' }))[0]!);
    const input = screen.getByRole('combobox', { name: 'Search' });
    // No People tab, so the placeholder must not promise a people search.
    expect(input.getAttribute('placeholder')).toBe('Search pages and actions…');
    await user.type(input, 'ab');

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Page', 'Action']);
    expect(searchCalls).toBe(0);
  });

  it('with `pages`, shows only the Page tab, navigates to a page and makes no /search call', async () => {
    let searchCalls = 0;
    server.use(
      http.get('/api/v1/search', () => {
        searchCalls += 1;
        return HttpResponse.json({});
      }),
    );
    const rootRoute = createRootRoute();
    const pages = [{ id: 'results', label: 'Results page', to: '/portal/results' }];
    const tree = rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => <CommandPaletteLauncher pages={pages} />,
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/portal/results',
        component: () => <p data-testid="results-page" />,
      }),
    ]);
    const { router } = renderWithRouter(tree, {
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Search (Ctrl+K)' }));
    await user.type(screen.getByRole('combobox', { name: 'Search' }), 'Results');

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Page']);
    await user.click(await screen.findByRole('option', { name: /Results page/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/portal/results'));
    // Wait past the 300 ms search debounce, or a late /search call would be missed.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(searchCalls).toBe(0);
  });

  describe('[48.3.15] Epic 48 actions use the route ids', () => {
    async function openActions(entry: string, role: string, query: string) {
      const view = renderWithRouter(routeTree, {
        initialEntries: [entry],
        tenantId: 'tenant-1',
        role,
        locale: 'en',
      });
      const user = userEvent.setup();
      await user.click((await screen.findAllByRole('button', { name: 'Search (Ctrl+K)' }))[0]!);
      await user.type(screen.getByRole('combobox', { name: 'Search' }), query);
      return { ...view, user };
    }

    it('on an exam page an EXAM_CONTROLLER lands on that exam’s Print tab', async () => {
      const { user, router } = await openActions('/exams/e-1', 'EXAM_CONTROLLER', '>admit');
      await user.click(await screen.findByRole('option', { name: 'Print admit cards' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/exams/e-1'));
      expect(router.state.location.search).toMatchObject({ tab: 'print' });
    });

    it('on a student page an OFFICE_STAFF opens the issue modal (issue=pick)', async () => {
      const { user, router } = await openActions('/students/s-1', 'OFFICE_STAFF', '>issue');
      await user.click(await screen.findByRole('option', { name: 'Issue certificate' }));
      await waitFor(() =>
        expect(router.state.location.search).toMatchObject({ tab: 'documents', issue: 'pick' }),
      );
    });

    const absent = (name: string) => expect(screen.queryByRole('option', { name })).toBeNull();

    it('a role without CERTIFICATE_ISSUE sees Certificate register but not Issue certificate', async () => {
      await openActions('/students/s-1', 'EXAM_CONTROLLER', '>certificate');
      expect(await screen.findByRole('option', { name: 'Certificate register' })).toBeTruthy();
      absent('Issue certificate');
    });

    it('Issue certificate is absent on a page with no student', async () => {
      await openActions('/students', 'OFFICE_STAFF', '>certificate');
      expect(await screen.findByRole('option', { name: 'Certificate register' })).toBeTruthy();
      absent('Issue certificate');
    });

    it('Print admit cards is absent without EXAM_MANAGE', async () => {
      await openActions('/exams/e-1', 'OFFICE_STAFF', '>print');
      expect(await screen.findByRole('option', { name: 'Print student ID card' })).toBeTruthy();
      absent('Print admit cards');
    });

    it('Print admit cards is absent off an exam page', async () => {
      await openActions('/students', 'EXAM_CONTROLLER', '>print');
      expect(await screen.findByRole('option', { name: 'Print student ID card' })).toBeTruthy();
      absent('Print admit cards');
    });

    it('a PRINT_HISTORY_READ-only role does not see To print', async () => {
      await openActions('/students', 'EXECUTIVE', '>print');
      expect(await screen.findByRole('option', { name: 'Print history' })).toBeTruthy();
      absent('To print');
    });
  });
});
