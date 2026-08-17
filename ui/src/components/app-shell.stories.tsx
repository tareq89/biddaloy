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
