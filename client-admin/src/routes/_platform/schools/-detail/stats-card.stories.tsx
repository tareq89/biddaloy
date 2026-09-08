import type { Meta, StoryObj } from '@storybook/react-vite';

import { StatsCard } from './stats-card';

/**
 * #535's stats card — ACTIVE-school-shaped data vs. a loading/error state.
 * Same not-wired-into-`client-admin`-Storybook gap #533/#534's own stories
 * note; written to follow that precedent regardless.
 */
const meta: Meta<typeof StatsCard> = {
  component: StatsCard,
  args: {
    loading: false,
  },
};
export default meta;

type Story = StoryObj<typeof StatsCard>;

export const ActiveSchool: Story = {
  args: {
    stats: {
      active_users: 42,
      students: 615,
      communications_queued: 3,
      communications_failed_7d: 0,
      last_activity_at: new Date().toISOString(),
    },
  },
};

export const Loading: Story = {
  args: {
    loading: true,
  },
};

export const LoadError: Story = {
  args: {
    error: 'Could not load stats.',
  },
};
