/**
 * No loading/empty/error/disabled variants — `AppShell` is pure layout
 * (a nav list and a content slot), it doesn't fetch or hold state of its
 * own, so none of those categories apply. RightToLeft is included since
 * the sidebar's icon+label row does change under `dir="rtl"`.
 */
import type { Meta, StoryObj } from '@storybook/react';

import { withMemoryRouter } from '../../.storybook/router-decorator';
import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { AppShell } from './app-shell';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/students', label: 'Students' },
  { to: '/fees', label: 'Fees' },
  { to: '/settings', label: 'Settings' },
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
