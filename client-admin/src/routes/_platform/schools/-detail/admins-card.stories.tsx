import type { Meta, StoryObj } from '@storybook/react-vite';

import { AdminsCard } from './admins-card';

/**
 * #535's admins card — a list with one pending invitation, requested
 * explicitly by the issue's acceptance criteria. Same not-wired-into-
 * `client-admin`-Storybook gap #533/#534's own stories note.
 */
const meta: Meta<typeof AdminsCard> = {
  component: AdminsCard,
  args: {
    schoolId: '00000000-0000-4000-8000-000000000001',
    loading: false,
  },
};
export default meta;

type Story = StoryObj<typeof AdminsCard>;

export const WithPendingInvitation: Story = {
  args: {
    admins: [
      {
        user_id: '00000000-0000-4000-8000-000000000002',
        name: 'Fatima Rahman',
        email: 'fatima@example.com',
        phone: null,
        membership_status: 'ACTIVE',
        invitation: {
          id: '00000000-0000-4000-8000-000000000003',
          status: 'PENDING',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
      },
      {
        user_id: '00000000-0000-4000-8000-000000000004',
        name: 'Karim Ahmed',
        email: 'karim@example.com',
        phone: null,
        membership_status: 'ACTIVE',
        invitation: null,
      },
    ],
  },
};

export const Empty: Story = {
  args: {
    admins: [],
  },
};

export const Loading: Story = {
  args: {
    loading: true,
  },
};
