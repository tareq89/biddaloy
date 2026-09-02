import { Permission } from '@biddaloy/shared';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  // [8.14.3]: `env(safe-area-inset-bottom)` resolves to 0px everywhere but
  // an installed, `viewport-fit=cover` PWA, so this costs nothing in every
  // other context — see `ui/src/styles/globals.css`'s own comment on the
  // `--safe-area-bottom` token this class references.
  it('pads the nav with the safe-area-aware bottom inset', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/portal'], role: 'PARENT' });

    const nav = await screen.findByRole('navigation', { name: 'Portal' });
    expect(nav.className).toContain('pb-(--safe-area-bottom)');
  });

  describe('[8.14.3] more cell', () => {
    function buildMoreTree(items: { to: string; label: string; permission?: Permission }[]) {
      const rootRoute = createRootRoute();
      const indexRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/portal',
        component: () => <BottomNav items={items} label="Portal" more={{ label: 'More' }} />,
      });
      return rootRoute.addChildren([indexRoute]);
    }

    it('renders a trailing button cell, not a link, carrying no aria-current', async () => {
      renderWithRouter(buildMoreTree(items), { initialEntries: ['/portal'], role: 'PARENT' });

      const nav = await screen.findByRole('navigation', { name: 'Portal' });
      const more = within(nav).getByRole('button', { name: 'More' });
      expect(more.tagName).toBe('BUTTON');
      expect(more.getAttribute('aria-haspopup')).toBe('dialog');
      expect(more.getAttribute('aria-current')).toBeNull();
    });

    it('does nothing when clicked with no AppShell ancestor (default no-op context)', async () => {
      const user = userEvent.setup();
      renderWithRouter(buildMoreTree(items), { initialEntries: ['/portal'], role: 'PARENT' });

      const more = await screen.findByRole('button', { name: 'More' });
      // The default `useAppShellDrawer()` value is an inert no-op — this
      // must not throw, and nothing resembling a dialog should appear.
      await user.click(more);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('keeps the bar visible — with only the more cell — even when the active role can see none of the items', async () => {
      // [8.14.3]: `more` is itself a form of navigation (it opens the
      // drawer holding every other destination), so its presence alone is
      // reason enough to keep the bar even when the active role sees zero
      // of `items` — the old `visible.length === 0` guard alone would
      // otherwise leave that role with no navigation at all below `md`.
      renderWithRouter(
        buildMoreTree([
          { to: '/portal/admin', label: 'Admin', permission: Permission.SETTINGS_MANAGE },
        ]),
        { initialEntries: ['/portal'], role: 'PARENT' },
      );

      const nav = await screen.findByRole('navigation', { name: 'Portal' });
      expect(within(nav).queryAllByRole('link')).toEqual([]);
      expect(within(nav).getByRole('button', { name: 'More' })).toBeTruthy();
    });

    it('is axe clean with more present', async () => {
      const { container } = renderWithRouter(buildMoreTree(items), {
        initialEntries: ['/portal'],
        role: 'PARENT',
      });
      await screen.findByRole('button', { name: 'More' });
      await expect(container).toHaveNoViolations();
    });

    it('caps the staff shape at 5 cells — 4 destinations + more, never more', async () => {
      // [8.14.3]: the cap `bottom-nav.tsx`'s own header comment documents —
      // staff's 4 permission-gated destinations plus `more`, never
      // silently truncated by the component itself (that's the caller's
      // job; this pins the shape the caller is expected to hand in).
      const staffItems = [
        { to: '/dashboard', label: 'Dashboard' },
        { to: '/students', label: 'Students' },
        { to: '/fees/dues', label: 'Student Dues' },
        { to: '/payments/record', label: 'Record Payment' },
      ];
      renderWithRouter(buildMoreTree(staffItems), { initialEntries: ['/portal'], role: 'PARENT' });

      const nav = await screen.findByRole('navigation', { name: 'Portal' });
      expect(within(nav).getAllByRole('link')).toHaveLength(4);
      expect(within(nav).getByRole('button', { name: 'More' })).toBeTruthy();
    });
  });
});
