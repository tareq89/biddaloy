import { Permission } from '@biddaloy/shared';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LINK_KEYS, expectKeyboardOperable } from '../test/a11y';
import { renderWithRouter } from '../test/render-with-router';

import { BottomNav } from './bottom-nav';

const items = [
  { to: '/portal', label: 'Overview', permission: Permission.FEE_READ },
  { to: '/portal/fees', label: 'Fees', permission: Permission.INVOICE_READ },
  { to: '/portal/admin', label: 'Admin', permission: Permission.SETTINGS_MANAGE },
];

function buildRouteTree() {
  const rootRoute = createRootRoute();
  const make = (path: string, content: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => (
        <>
          <p>{content}</p>
          <BottomNav items={items} label="Portal" />
        </>
      ),
    });
  return rootRoute.addChildren([
    make('/portal', 'Overview content'),
    make('/portal/fees', 'Fees content'),
    make('/portal/admin', 'Admin content'),
  ]);
}

describe('BottomNav', () => {
  it('renders a named nav landmark with one link per permitted item', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/portal'], role: 'PARENT' });

    const nav = await screen.findByRole('navigation', { name: 'Portal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((el) => el.textContent),
    ).toEqual(['Overview', 'Fees']);
  });

  it('hides — never disables — an item the active role lacks the permission for', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/portal'], role: 'PARENT' });

    await screen.findByRole('navigation', { name: 'Portal' });
    // PARENT holds FEE_READ/INVOICE_READ but not SETTINGS_MANAGE.
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('marks only the current route link with aria-current="page"', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/portal/fees'], role: 'PARENT' });

    const active = await screen.findByRole('link', { name: 'Fees' });
    expect(active.getAttribute('aria-current')).toBe('page');
    expect(active.className).toContain('text-primary');
    const inactive = screen.getByRole('link', { name: 'Overview' });
    expect(inactive.getAttribute('aria-current')).toBeNull();
    expect(inactive.className).toContain('text-muted-foreground');
    // Exactly one colour utility per link — see the component's comment on
    // why active/inactive props are split rather than layered.
    expect(active.className).not.toContain('text-muted-foreground');
  });

  it('marks exactly one item current even when one item nests under another', async () => {
    // `/portal` is an ancestor of `/portal/fees`; the router's default
    // prefix match would call both active on this URL.
    renderWithRouter(buildRouteTree(), { initialEntries: ['/portal/fees'], role: 'PARENT' });

    const nav = await screen.findByRole('navigation', { name: 'Portal' });
    const current = within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual(['Fees']);
  });

  it('gives every item a touch target of at least 44px', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/portal'], role: 'PARENT' });

    const nav = await screen.findByRole('navigation', { name: 'Portal' });
    for (const link of within(nav).getAllByRole('link')) {
      // `min-h-14` is 56px — comfortably past the 44px minimum.
      expect(link.className).toContain('min-h-14');
    }
  });

  it('renders nothing when the role can see none of the items', () => {
    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/portal',
      component: () => (
        <BottomNav
          items={[{ to: '/portal/admin', label: 'Admin', permission: Permission.SETTINGS_MANAGE }]}
          label="Portal"
        />
      ),
    });
    renderWithRouter(rootRoute.addChildren([indexRoute]), {
      initialEntries: ['/portal'],
      role: 'PARENT',
    });

    expect(screen.queryByRole('navigation', { name: 'Portal' })).toBeNull();
  });

  it('every item is reachable and activatable by keyboard', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/portal'], role: 'PARENT' });

    const link = await screen.findByRole('link', { name: 'Fees' });
    await expectKeyboardOperable(link, { keys: LINK_KEYS });
  });

  it('is axe clean', async () => {
    const { container } = renderWithRouter(buildRouteTree(), {
      initialEntries: ['/portal'],
      role: 'PARENT',
    });
    await screen.findByText('Overview content');
    await expect(container).toHaveNoViolations();
  });
});
