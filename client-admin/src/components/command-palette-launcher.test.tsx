import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../routeTree.gen';

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
    await user.type(screen.getByRole('combobox', { name: 'Command palette' }), 'Karim');

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
    await user.type(screen.getByRole('combobox', { name: 'Command palette' }), 'Rahim');

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
    await user.type(screen.getByRole('combobox', { name: 'Command palette' }), 'Nasrin');

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
    const input = screen.getByRole('combobox', { name: 'Command palette' });
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
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    await user.type(input, '>student');

    await waitFor(() => expect(screen.queryByRole('option', { name: 'Add student' })).toBeNull());
  });
});
