import { UserRole } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SchoolInvitesCard } from './school-invites-card';

const meta: Meta<typeof SchoolInvitesCard> = {
  title: 'Account/SchoolInvitesCard',
  component: SchoolInvitesCard,
  tags: ['autodocs'],
  args: { onAccept: () => {}, onDecline: () => {} },
};

export default meta;
type Story = StoryObj<typeof SchoolInvitesCard>;

const rose = {
  id: 'invite-1',
  school_id: 'school-1',
  school_name: 'Rose Valley School',
  role: UserRole.PARENT,
  expires_at: '2026-10-20T00:00:00.000Z',
};
const green = {
  id: 'invite-2',
  school_id: 'school-2',
  school_name: 'Greenview School',
  role: UserRole.TEACHER,
  expires_at: '2026-10-25T00:00:00.000Z',
};

export const One: Story = { args: { invites: [rose] } };

export const Several: Story = { args: { invites: [rose, green] } };

export const Bangla: Story = { args: { invites: [rose, green] }, globals: { locale: 'bn' } };

export const WithError: Story = {
  args: { invites: [rose], error: 'Something went wrong. Please try again.' },
};

export const Busy: Story = { args: { invites: [rose, green], busy: true } };
