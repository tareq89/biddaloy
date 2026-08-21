/**
 * No loading/error/disabled state applies — `TenantBar` reads
 * already-decoded local state (the access token, the active tenant), it
 * doesn't fetch. `Empty` is replaced by `renders nothing before an active
 * tenant is chosen` (see `tenant-bar.test.tsx`), which isn't a visual
 * state a story can show. RightToLeft proves the menu/dialog copy and
 * layout survive a bidi flip.
 */
import { UserRole } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react';
import { userEvent, within } from '@storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';
import { setAccessToken, setActiveTenant } from '../api/auth-state';

import { TenantBar } from './tenant-bar';

function fakeJwt(memberships: unknown): string {
  const payload = btoa(JSON.stringify({ memberships }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

const singleSchool = [{ tenantId: 'tenant-1', role: UserRole.ADMIN, name: 'Greenview School' }];
const twoSchools = [
  { tenantId: 'tenant-1', role: UserRole.ADMIN, name: 'Greenview School' },
  { tenantId: 'tenant-2', role: UserRole.TEACHER, name: 'Rose Valley School' },
];

const meta: Meta<typeof TenantBar> = {
  title: 'Components/TenantBar',
  component: TenantBar,
  tags: ['autodocs'],
  decorators: [
    (Story) => {
      setAccessToken(fakeJwt(twoSchools));
      setActiveTenant('tenant-1');
      return <Story />;
    },
  ],
};

export default meta;
type Story = StoryObj<typeof TenantBar>;

export const Default: Story = {};

export const SingleMembership: Story = {
  decorators: [
    (Story) => {
      setAccessToken(fakeJwt(singleSchool));
      setActiveTenant('tenant-1');
      return <Story />;
    },
  ],
};

export const SwitchMenuOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Switch school' }));
  },
};

export const RightToLeft: Story = {
  decorators: [rtlDecorator],
};
