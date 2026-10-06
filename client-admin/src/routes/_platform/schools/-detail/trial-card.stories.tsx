import type { Meta, StoryObj } from '@storybook/react-vite';

import { TrialCard } from './trial-card';

/** [13.5] Trial card states: running, ended (extend is the way back), unlimited, and phone width. */
const meta: Meta<typeof TrialCard> = {
  component: TrialCard,
  args: { onExtend: () => {}, studentsUsed: 12 },
};
export default meta;

type Story = StoryObj<typeof TrialCard>;

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

export const Running: Story = {
  args: { school: { trial_ends_at: inDays(12), seat_limit: 50 } },
};

export const Ended: Story = {
  args: { school: { trial_ends_at: '2026-01-10T00:00:00.000Z', seat_limit: 50 } },
};

export const NoLimit: Story = {
  args: { school: { trial_ends_at: inDays(30), seat_limit: null } },
};

export const Phone: Story = {
  ...Running,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
