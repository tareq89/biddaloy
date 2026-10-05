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
    expect(searchCalls).toBe(0);
  });
});
