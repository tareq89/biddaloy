/**
 * No loading/empty/error/disabled variants — `AppShell` is pure layout
 * (a nav list and a content slot), it doesn't fetch or hold state of its
 * own, so none of those categories apply. RightToLeft is included since
 * the sidebar's icon+label row does change under `dir="rtl"`. [8.9.6]
 * adds `Grouped` (domain sections, pinned items) and `MobileDrawer`
 * (the responsive drawer below 768px) per the approved `templates/
 * sidebar` mockup.
 */
import { Permission } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CreditCardIcon, HomeIcon } from 'lucide-react';

import { withMemoryRouter } from '../../.storybook/router-decorator';
import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { AppShell, type AppShellNavGroup } from './app-shell';
import { BottomNav } from './bottom-nav';

const navItems = [{ to: '/', label: 'Dashboard' }];

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
  { id: 'people', label: 'People', items: [{ to: '/students', label: 'Students' }] },
  {
    id: 'finance',
    label: 'Finance',
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
    items: [{ to: '/fees', label: 'Fees', permission: Permission.FEE_STRUCTURE_READ }],
  },
  {
    id: 'administration',
    label: 'Administration',
    items: [{ to: '/settings', label: 'Settings', permission: Permission.SETTINGS_MANAGE }],
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

export const RightToLeft: Story = {
  decorators: [rtlDecorator],
};

/** [8.9.5]'s persistent tenant/role bar — a plain `<div>` stand-in here
 * rather than the real `TenantBar` (`tenant-bar.stories.tsx` covers that
 * component's own states); this story only proves `AppShell` renders
 * whatever `topBar` is given as a full-width row above the sidebar. */
export const WithTopBar: Story = {
  args: {
    topBar: (
      <div className="border-b border-border px-4 py-2 text-sm">
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
