import { Permission } from '@biddaloy/shared';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomeIcon, SettingsIcon, UsersRoundIcon, WalletIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { LINK_KEYS, expectKeyboardOperable } from '../test/a11y';
import { renderWithRouter } from '../test/render-with-router';

import {
  APP_HEADER_HEIGHT_VAR,
  APP_SHELL_MAIN_ID,
  AppShell,
  type AppShellNavGroup,
} from './app-shell';

const navItems = [{ to: '/', label: 'Dashboard', icon: <HomeIcon aria-hidden="true" /> }];

const navGroups: AppShellNavGroup[] = [
  {
    id: 'people',
    label: 'People',
    items: [{ to: '/students', label: 'Students', icon: <UsersRoundIcon aria-hidden="true" /> }],
  },
  {
    id: 'finance',
    label: 'Finance',
    // [8.9.6]'s literal AC: pinned above the rest, gated on a permission
    // only ACCOUNTANT/ADMIN hold, distinct from Fees' broader one.
    // [8.14.1] — the micro-label above the pinned pair.
    pinnedLabel: 'Quick actions',
    pinnedItems: [
      {
        to: '/fees',
        search: { tab: 'dues' },
        label: 'Student Dues',
        permission: Permission.FEE_COLLECT,
      },
      {
        to: '/fees',
        search: { tab: 'payment' },
        label: 'Record Payment',
        permission: Permission.PAYMENT_RECORD,
      },
    ],
    items: [
      {
        to: '/fees',
        label: 'Fees',
        permission: Permission.FEE_STRUCTURE_READ,
        icon: <WalletIcon aria-hidden="true" />,
      },
    ],
  },
  {
    id: 'administration',
    label: 'Administration',
    items: [
      {
        to: '/settings',
        label: 'Settings',
        permission: Permission.SETTINGS_MANAGE,
        icon: <SettingsIcon aria-hidden="true" />,
      },
    ],
  },
];

function buildRouteTree() {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <AppShell navItems={navItems} navGroups={navGroups} brand="Biddaloy">
        <p>Dashboard content</p>
      </AppShell>
    ),
  });
  const studentsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/students',
    component: () => (
      <AppShell navItems={navItems} navGroups={navGroups} brand="Biddaloy">
        <p>Students content</p>
      </AppShell>
    ),
  });
  return rootRoute.addChildren([indexRoute, studentsRoute]);
}

describe('AppShell', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('renders every visible nav item as a link, and the active-route content', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/students'], role: 'SUPER_ADMIN' });

    expect(await screen.findByRole('link', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Students' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Fees' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByText('Students content')).toBeTruthy();
  });

  it('marks the current route link with aria-current="page"', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/students'], role: 'SUPER_ADMIN' });

    const activeLink = await screen.findByRole('link', { name: 'Students' });
    expect(activeLink.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('aria-current')).toBeNull();
  });

  it('every nav link is reachable and activatable by keyboard', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/students'], role: 'SUPER_ADMIN' });

    const link = await screen.findByRole('link', { name: 'Dashboard' });
    await expectKeyboardOperable(link, { keys: LINK_KEYS });
  });

  it('is axe clean', async () => {
    const { container } = renderWithRouter(buildRouteTree(), {
      initialEntries: ['/students'],
      role: 'SUPER_ADMIN',
    });
    await screen.findByText('Students content');
    await expect(container).toHaveNoViolations();
  });

  it('[8.9.5] renders the optional topBar as a full-width row above the sidebar', async () => {
    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => (
        <AppShell navItems={navItems} brand="Biddaloy" topBar={<div>Greenview School</div>}>
          <p>Dashboard content</p>
        </AppShell>
      ),
    });
    renderWithRouter(rootRoute.addChildren([indexRoute]), { initialEntries: ['/'] });

    expect(await screen.findByText('Greenview School')).toBeTruthy();
  });

  it('renders nothing extra when topBar is omitted', async () => {
    renderWithRouter(buildRouteTree(), { initialEntries: ['/students'], role: 'SUPER_ADMIN' });

    await screen.findByText('Students content');
    expect(screen.queryByText('Greenview School')).toBeNull();
  });

  describe('[8.14.2] --app-header-h contract', () => {
    afterEach(() => {
      document.documentElement.style.removeProperty(APP_HEADER_HEIGHT_VAR);
    });

    it('writes --app-header-h onto documentElement when topBar is present, and removes it on unmount', async () => {
      const rootRoute = createRootRoute();
      const indexRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => (
          <AppShell navItems={navItems} brand="Biddaloy" topBar={<div>Greenview School</div>}>
            <p>Dashboard content</p>
          </AppShell>
        ),
      });
      const { unmount } = renderWithRouter(rootRoute.addChildren([indexRoute]), {
        initialEntries: ['/'],
      });

      await screen.findByText('Greenview School');
      await waitFor(() =>
        expect(document.documentElement.style.getPropertyValue(APP_HEADER_HEIGHT_VAR)).not.toBe(''),
      );

      unmount();

      expect(document.documentElement.style.getPropertyValue(APP_HEADER_HEIGHT_VAR)).toBe('');
    });

    it('does not write --app-header-h when topBar is absent', async () => {
      renderWithRouter(buildRouteTree(), { initialEntries: ['/students'], role: 'SUPER_ADMIN' });

      await screen.findByText('Students content');
      expect(document.documentElement.style.getPropertyValue(APP_HEADER_HEIGHT_VAR)).toBe('');
    });
  });

  describe('[8.9.6] domain groups, role-gated', () => {
    it('renders Finance pinned above the rest, separated by a divider', async () => {
      renderWithRouter(buildRouteTree(), { initialEntries: ['/students'], role: 'ACCOUNTANT' });

      const nav = await screen.findByRole('navigation', { name: 'Main' });
      const links = within(nav)
        .getAllByRole('link')
        .map((el) => el.textContent);
      // Dashboard, then People's Students, then Finance's pinned two,
      // then Finance's Fees — Administration absent (SETTINGS_MANAGE not
      // held by ACCOUNTANT).
      expect(links).toEqual(['Dashboard', 'Students', 'Student Dues', 'Record Payment', 'Fees']);
      expect(within(nav).getByRole('link', { name: 'Student Dues' }).getAttribute('href')).toBe(
        '/fees?tab=dues',
      );
      expect(within(nav).getByRole('link', { name: 'Record Payment' }).getAttribute('href')).toBe(
        '/fees?tab=payment',
      );
      expect(screen.queryByText('Settings')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Administration' })).toBeNull();
    });

    it('hides a group entirely — not disabled — when the role has zero permitted items', async () => {
      renderWithRouter(buildRouteTree(), { initialEntries: ['/students'], role: 'TEACHER' });

      await screen.findByRole('link', { name: 'Students' });
      // TEACHER holds neither FEE_COLLECT, PAYMENT_RECORD, FEE_STRUCTURE_READ
      // nor SETTINGS_MANAGE — Finance and Administration render nothing,
      // not a heading with no items under it.
      expect(screen.queryByText('Finance')).toBeNull();
      expect(screen.queryByText('Administration')).toBeNull();
      expect(screen.queryByText('Student Dues')).toBeNull();
      expect(screen.queryByText('Settings')).toBeNull();
    });

    it('a group header toggles collapse and persists the state to localStorage', async () => {
      const user = userEvent.setup();
      renderWithRouter(buildRouteTree(), { initialEntries: ['/students'], role: 'SUPER_ADMIN' });

      const header = await screen.findByRole('button', { name: 'Finance' });
      expect(header.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByRole('link', { name: 'Fees' })).toBeTruthy();

      await user.click(header);
      expect(header.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByRole('link', { name: 'Fees' })).toBeNull();
      expect(window.localStorage.getItem('nav-group-collapsed:finance')).toBe('true');
    });
  });

  describe('[8.9.6] mobile drawer', () => {
    it('opens over a backdrop, traps focus, and restores focus to the trigger on close', async () => {
      const user = userEvent.setup();
      renderWithRouter(buildRouteTree(), { initialEntries: ['/students'], role: 'SUPER_ADMIN' });

      const trigger = await screen.findByRole('button', { name: 'Open menu' });
      await user.click(trigger);
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('link', { name: 'Students' })).toBeTruthy();

      for (let i = 0; i < 10; i++) {
        await user.tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
      }

      await user.click(within(dialog).getByRole('button', { name: 'Close menu' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.activeElement).toBe(trigger);
    });

    it('clicking a nav link inside the drawer closes it', async () => {
      const user = userEvent.setup();
      renderWithRouter(buildRouteTree(), { initialEntries: ['/students'], role: 'SUPER_ADMIN' });

      await user.click(await screen.findByRole('button', { name: 'Open menu' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('link', { name: 'Dashboard' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('is axe clean while open', async () => {
      const user = userEvent.setup();
      const { baseElement } = renderWithRouter(buildRouteTree(), {
        initialEntries: ['/students'],
        role: 'SUPER_ADMIN',
      });

      await user.click(await screen.findByRole('button', { name: 'Open menu' }));
      await screen.findByRole('dialog');
      await expect(baseElement).toHaveNoViolations();
    });
  });

  describe('[5.2] optional bottomNav slot', () => {
    const portalBar = <nav aria-label="Portal">Bottom bar</nav>;

    // No default parameter: one of the cases below passes `undefined`
    // deliberately, and a default would quietly swap the real bar back in.
    function buildBottomNavTree(slot: ReactNode) {
      const rootRoute = createRootRoute();
      const indexRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => (
          <AppShell navItems={navItems} brand="Biddaloy" bottomNav={slot}>
            <p>Portal content</p>
          </AppShell>
        ),
      });
      return rootRoute.addChildren([indexRoute]);
    }

    it('renders the slot and drops the mobile hamburger drawer when provided', async () => {
      renderWithRouter(buildBottomNavTree(portalBar), { initialEntries: ['/'], role: 'PARENT' });

      expect(await screen.findByRole('navigation', { name: 'Portal' })).toBeTruthy();
      // The <md header bar exists only to open the drawer; with a bottom
      // bar there is nothing left for it to do.
      expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull();
    });

    it('pads <main> below the bar so content can scroll clear of it', async () => {
      renderWithRouter(buildBottomNavTree(portalBar), { initialEntries: ['/'], role: 'PARENT' });

      await screen.findByText('Portal content');
      const main = document.getElementById(APP_SHELL_MAIN_ID);
      expect(main?.className).toContain('pb-24');
      expect(main?.className).toContain('md:pb-6');
    });

    it('is axe clean with a bottom bar', async () => {
      const { container } = renderWithRouter(buildBottomNavTree(portalBar), {
        initialEntries: ['/'],
        role: 'PARENT',
      });
      await screen.findByText('Portal content');
      await expect(container).toHaveNoViolations();
    });

    it('changes nothing when omitted — the staff shell keeps its drawer and its unpadded main', async () => {
      renderWithRouter(buildRouteTree(), { initialEntries: ['/students'], role: 'SUPER_ADMIN' });

      await screen.findByText('Students content');
      expect(screen.getByRole('button', { name: 'Open menu' })).toBeTruthy();
      const main = document.getElementById(APP_SHELL_MAIN_ID);
      expect(main?.className).toBe('min-w-0 flex-1 p-6');
      expect(screen.queryByRole('navigation', { name: 'Portal' })).toBeNull();
    });

    // `ReactNode` admits `null`/`false`, so `bottomNav={enabled && <Bar />}`
    // is a shape a caller can reach with no type error. Treating that as
    // "has a bottom bar" would drop the drawer *and* render no bar, leaving
    // the <md viewport with no navigation at all.
    it.each([
      ['false', false],
      ['null', null],
      ['undefined', undefined],
    ])('treats a %s slot as omitted, keeping the drawer', async (_label, slot) => {
      renderWithRouter(buildBottomNavTree(slot), { initialEntries: ['/'], role: 'PARENT' });

      await screen.findByText('Portal content');
      expect(screen.getByRole('button', { name: 'Open menu' })).toBeTruthy();
      expect(document.getElementById(APP_SHELL_MAIN_ID)?.className).toBe('min-w-0 flex-1 p-6');
    });
  });

  describe('[8.14.1] sidebar hierarchy', () => {
    it('styles the active item distinctly from a merely-hovered inactive item', async () => {
      renderWithRouter(buildRouteTree(), { initialEntries: ['/students'], role: 'SUPER_ADMIN' });

      const activeLink = await screen.findByRole('link', { name: 'Students' });
      const inactiveLink = screen.getByRole('link', { name: 'Dashboard' });

      // Mirrors `bottom-nav.test.tsx`'s own assertion shape on the
      // active/inactive `className` split (`bottom-nav.test.tsx:63`).
      expect(activeLink.className).toContain('text-primary');
      expect(activeLink.className).toContain('bg-primary/10');
      expect(activeLink.className).toContain('font-semibold');
      expect(activeLink.getAttribute('aria-current')).toBe('page');

      expect(inactiveLink.className).not.toContain('text-primary');
      expect(inactiveLink.className).not.toContain('bg-primary/10');
      expect(inactiveLink.className).toContain('hover:bg-accent');
      expect(inactiveLink.getAttribute('aria-current')).toBeNull();

      // The regression this ticket exists for: before 8.14.1 the active item
      // was `bg-accent`, i.e. pixel-identical to any hovered inactive one.
      // The active item must therefore NOT carry the hover treatment.
      expect(activeLink.className).not.toContain('hover:bg-accent');
    });

    it('keeps a visible focus-visible outline — no outline-none anywhere on nav links', async () => {
      renderWithRouter(buildRouteTree(), { initialEntries: ['/students'], role: 'SUPER_ADMIN' });

      const link = await screen.findByRole('link', { name: 'Dashboard' });
      expect(link.className).toContain('focus-visible:outline');
      expect(link.className).not.toContain('outline-none');
    });

    it('renders every nav icon aria-hidden, leaving accessible link names unchanged', async () => {
      renderWithRouter(buildRouteTree(), { initialEntries: ['/students'], role: 'SUPER_ADMIN' });

      const nav = await screen.findByRole('navigation', { name: 'Main' });
      const visibleIcons = nav.querySelectorAll('svg:not([aria-hidden="true"])');
      expect(visibleIcons.length).toBe(0);

      const links = within(nav)
        .getAllByRole('link')
        .map((el) => el.textContent);
      expect(links).toEqual([
        'Dashboard',
        'Students',
        'Student Dues',
        'Record Payment',
        'Fees',
        'Settings',
      ]);
    });

    it('shows the optional pinnedLabel micro-heading above the pinned items', async () => {
      renderWithRouter(buildRouteTree(), { initialEntries: ['/students'], role: 'SUPER_ADMIN' });

      const label = await screen.findByText('Quick actions');
      expect(label.getAttribute('aria-hidden')).toBe('true');

      // Position is the whole point of the prop, and `findByText` alone
      // cannot see it: the label must precede the pinned item it names, not
      // sit between the pinned run and the ordinary one (where it would read
      // as a heading for the *ordinary* items).
      const list = label.closest('ul');
      const items = [...(list?.children ?? [])];
      const labelIndex = items.indexOf(label);
      const pinnedIndex = items.findIndex(
        (node) => node.querySelector('a')?.textContent === 'Student Dues',
      );
      expect(labelIndex).toBeGreaterThanOrEqual(0);
      expect(pinnedIndex).toBeGreaterThan(labelIndex);

      // ...and the hairline still separates the pinned run from the rest.
      const divider = list?.querySelector('li.border-t.border-border-subtle');
      expect(divider).not.toBeNull();
    });

    it('falls back to the plain hairline divider when pinnedLabel is omitted', async () => {
      const rootRoute = createRootRoute();
      const noPinnedLabelGroups: AppShellNavGroup[] = [
        {
          id: 'finance-no-label',
          label: 'Finance',
          pinnedItems: [{ to: '/fees', label: 'Student Dues', permission: Permission.FEE_COLLECT }],
          items: [{ to: '/fees', label: 'Fees', permission: Permission.FEE_STRUCTURE_READ }],
        },
      ];
      const indexRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => (
          <AppShell navItems={navItems} navGroups={noPinnedLabelGroups} brand="Biddaloy">
            <p>Dashboard content</p>
          </AppShell>
        ),
      });
      renderWithRouter(rootRoute.addChildren([indexRoute]), {
        initialEntries: ['/'],
        role: 'SUPER_ADMIN',
      });

      await screen.findByText('Dashboard content');
      expect(screen.queryByText('Quick actions')).toBeNull();
      const divider = document.querySelector('li.border-t.border-border-subtle');
      expect(divider).not.toBeNull();
    });

    it('scrolls the sidebar on its own, independent of page scroll', async () => {
      renderWithRouter(buildRouteTree(), { initialEntries: ['/students'], role: 'SUPER_ADMIN' });

      await screen.findByText('Students content');
      const aside = document.querySelector('aside');
      expect(aside?.className).toContain('overflow-y-auto');
      expect(aside?.className).toContain('md:sticky');
      // `max-h`, not `h`: a fixed `h-svh` on this flex item would set the
      // content row's min-height to a full viewport, so every desktop page
      // would gain a permanent scrollbar the height of the top bar.
      expect(aside?.className).toContain('md:max-h-svh');
      expect(aside?.className).not.toContain('md:h-svh');
    });

    // NOTE: axe-cleanliness and keyboard operability of this markup are
    // already covered by 'is axe clean' and 'every nav link is reachable and
    // activatable by keyboard' above — `navGroups` is a module-level fixture
    // that carries the icons and the pinned label, so those two tests
    // exercise the 8.14.1 markup as-is. Duplicating them here would add
    // runtime without adding coverage.
  });
});
