/**
 * No loading/empty/error/disabled variants — `AppShell` is pure layout
 * (a nav list and a content slot), it doesn't fetch or hold state of its
 * own, so none of those categories apply. RightToLeft is included since
 * the sidebar's icon+label row does change under `dir="rtl"`. [8.9.6]
 * adds `Grouped` (domain sections, pinned items) and `MobileDrawer`
 * (the responsive drawer below 768px) per the approved `templates/
 * sidebar` mockup.
 *
 * [8.14.1] adds the sidebar hierarchy states: `ActiveVsHover` (the active
 * item next to a hoverable inactive one — this is the story the "active is
 * distinguishable from hover" AC is judged against) and `ScrollingSidebar`
 * (the aside scrolling independently of the page). `Grouped` and
 * `MobileDrawer` pick up the per-item icons and the pinned micro-label for
 * free from the shared fixture, and `RightToLeft` now passes `navGroups` so
 * it actually mirrors the new indent, guide line and label.
 */
import { Permission } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  BanknoteIcon,
  BriefcaseIcon,
  CreditCardIcon,
  HandCoinsIcon,
  HomeIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  UsersRoundIcon,
  WalletIcon,
} from 'lucide-react';

import { withMemoryRouter } from '../../.storybook/router-decorator';
import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { AppShell, type AppShellNavGroup } from './app-shell';
import { BottomNav } from './bottom-nav';

const navItems = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboardIcon aria-hidden="true" /> },
];

/** The family portal's two items — the same array feeds `AppShell`'s nav
 * and the bottom bar, which is the point of them sharing a shape. */
const portalNavItems = [
  { to: '/portal', label: 'Overview', icon: <HomeIcon className="size-5" aria-hidden="true" /> },
  {
    to: '/portal/fees',
    label: 'Fees and invoices',
    icon: <CreditCardIcon className="size-5" aria-hidden="true" />,
  },
];

const navGroups: AppShellNavGroup[] = [
  {
    id: 'people',
    label: 'People',
    items: [
      { to: '/students', label: 'Students', icon: <UsersRoundIcon aria-hidden="true" /> },
      { to: '/staff', label: 'Staff', icon: <BriefcaseIcon aria-hidden="true" /> },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    pinnedLabel: 'Quick actions',
    pinnedItems: [
      {
        to: '/fees',
        search: { tab: 'dues' },
        label: 'Student Dues',
        permission: Permission.FEE_COLLECT,
        icon: <HandCoinsIcon aria-hidden="true" />,
      },
      {
        to: '/fees',
        search: { tab: 'payment' },
        label: 'Record Payment',
        permission: Permission.PAYMENT_RECORD,
        icon: <BanknoteIcon aria-hidden="true" />,
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

const meta: Meta<typeof AppShell> = {
  title: 'Components/AppShell',
  component: AppShell,
  tags: ['autodocs'],
  args: { navItems, brand: 'Biddaloy', children: <p>Page content</p> },
  // `Link`'s active-state and hover-preload behaviour both read router
  // context, so every story needs one — see `withMemoryRouter`'s own
  // comment for why this is a decorator factory, not a shared instance.
  decorators: [withMemoryRouter(['/students'])],
};

export default meta;
type Story = StoryObj<typeof AppShell>;

export const Default: Story = {};

/** [8.14.1] carries `navGroups` so this story actually exercises the three
 * things the ticket added — the group heading, the vertical guide line and
 * the pinned micro-label — all of which are positioned with logical
 * properties (`ps-6`, `before:start-3`) and so must mirror under `dir="rtl"`.
 * Without `navGroups` this story renders a flat `navItems` list and proves
 * none of that. */
export const RightToLeft: Story = {
  args: { navGroups },
  decorators: [rtlDecorator],
};

/** [8.9.5]'s persistent tenant/role bar — a plain `<div>` stand-in here
 * rather than the real `TenantBar` (`tenant-bar.stories.tsx` covers that
 * component's own states); this story only proves `AppShell` renders
 * whatever `topBar` is given as a full-width row above the sidebar. */
export const WithTopBar: Story = {
  args: {
    topBar: (
      <div className="border-b border-border-subtle px-4 py-2 text-sm">
        Greenview School <span className="text-muted-foreground">Admin</span>
      </div>
    ),
  },
};

/** Rendered as SUPER_ADMIN by default in Storybook (no auth-state seeded),
 * so every permissioned item — including Finance's pinned Student Dues/
 * Record Payment — shows through `hasPermission`'s fail-open-for-
 * SUPER_ADMIN mapping. See `app-shell.test.tsx` for the per-role
 * (ACCOUNTANT/TEACHER) hidden-group coverage this story can't show
 * without seeding `auth-state`. */
export const Grouped: Story = {
  args: { navGroups },
};

/** `viewport` addon param narrows the canvas below the `md` breakpoint so
 * the desktop `<aside>` gives way to the menu-button + drawer described in
 * `app-shell.tsx`'s own doc comment. */
export const MobileDrawer: Story = {
  args: { navGroups },
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
};

/** [8.14.1] — proves the active item (Students, from the decorator's
 * `/students` route) reads as tinted background + colour + weight + a
 * left accent bar, never merely `font-medium` the way a hovered inactive
 * item like Fees or Settings would. Hover Fees/Settings in the addon
 * panel's canvas to compare against Students at rest. */
export const ActiveVsHover: Story = {
  args: { navGroups },
};

/** [8.14.1] — a nav long enough to overflow the viewport on its own, plus
 * tall `children`, proving the `<aside>` scrolls independently
 * (`overflow-y-auto` + `md:sticky md:top-0 md:max-h-svh`) while the rest of
 * the shell's chrome stays put.
 *
 * Six copies of the fixture (~30 links) is deliberate: at three copies the
 * list still fits a laptop canvas, so the story would document independent
 * scrolling without ever demonstrating it. */
export const ScrollingSidebar: Story = {
  args: {
    navGroups: Array.from({ length: 6 }, (_, copy) =>
      navGroups.map((group) => ({
        ...group,
        id: copy === 0 ? group.id : `${group.id}-${copy}`,
        label: copy === 0 ? group.label : `${group.label} ${copy + 1}`,
      })),
    ).flat(),
    children: (
      <div style={{ height: '200vh' }}>
        Scroll the page: the sidebar pins to the top and scrolls its own overflow, rather than
        scrolling away with this content.
      </div>
    ),
  },
  parameters: {
    layout: 'fullscreen',
  },
};

/** [5.2]'s opt-in `bottomNav` slot — the family portal's two-item mobile
 * bar in place of the hamburger drawer. Narrowed to a mobile viewport
 * because the slot is `md:hidden`: at desktop width this story looks
 * identical to `Default`, which is exactly the guarantee the staff shell
 * relies on. */
export const WithBottomNav: Story = {
  args: {
    navItems: portalNavItems,
    bottomNav: <BottomNav items={portalNavItems} label="Portal" />,
  },
  decorators: [withMemoryRouter(['/portal'])],
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

/** [8.14.3] — the staff shape, in one story: `topBar` marked `hidden
 * md:flex` (desktop-only now — this canvas is mobile-width, so it renders
 * nothing), `mobileHeaderActions` (search + bell stand-ins) in the
 * consolidated header row, `drawerHeader` (a `TenantBar` stand-in) inside
 * the hamburger drawer, and a 4-item + `more` `bottomNav` at once — the
 * combination `WithBottomNav` above deliberately does not show, since the
 * portal drops the header row entirely once `bottomNav` is set. */
export const StaffMobile: Story = {
  args: {
    navItems,
    navGroups,
    topBar: (
      <div className="hidden border-b border-border-subtle px-4 py-2 text-sm md:flex">
        Greenview School <span className="text-muted-foreground">Admin</span>
      </div>
    ),
    mobileHeaderActions: (
      <>
        <button type="button" aria-label="Search (Ctrl+K)">
          <CreditCardIcon className="size-4" aria-hidden="true" />
        </button>
        <button type="button" aria-label="Notifications">
          <HomeIcon className="size-4" aria-hidden="true" />
        </button>
      </>
    ),
    drawerHeader: (
      <div className="mb-4 flex flex-col gap-2">
        <div className="text-sm">
          Greenview School <span className="text-muted-foreground">Admin</span>
        </div>
      </div>
    ),
    bottomNav: (
      <BottomNav
        items={[
          navItems[0]!,
          { to: '/students', label: 'Students', icon: <UsersRoundIcon aria-hidden="true" /> },
          {
            to: '/fees',
            label: 'Student Dues',
            icon: <HandCoinsIcon aria-hidden="true" />,
          },
          {
            to: '/fees',
            label: 'Record Payment',
            icon: <BanknoteIcon aria-hidden="true" />,
          },
        ]}
        label="Quick navigation"
        more={{ label: 'More' }}
      />
    ),
  },
  decorators: [withMemoryRouter(['/students'])],
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
