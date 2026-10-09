import type { Meta, StoryObj } from '@storybook/react-vite';

import { EngineHealthCard } from './-engine-health';

const meta: Meta<typeof EngineHealthCard> = {
  component: EngineHealthCard,
  args: { loading: false, onRetry: () => undefined, now: new Date('2026-10-09T10:00:00Z') },
};
export default meta;

type Story = StoryObj<typeof EngineHealthCard>;

const ok = {
  lastSweep: {
    FAST: '2026-10-09T09:58:00Z',
    HOURLY: '2026-10-09T09:30:00Z',
    DAILY: '2026-10-09T01:00:00Z',
  },
  durationsMs: { FAST: 1200, HOURLY: 4300, DAILY: 21000 },
  failingRules: [],
};

export const Healthy: Story = { args: { health: ok } };

export const Late: Story = {
  args: { health: { ...ok, lastSweep: { ...ok.lastSweep, FAST: '2026-10-09T09:20:00Z' } } },
};

export const TwoFailingRules: Story = {
  args: {
    health: {
      ...ok,
      failingRules: [
        { key: 'attendance.not_taken', count: 3, lastError: 'QueryFailedError: deadlock detected' },
        { key: 'fees.overdue_rising', count: 1, lastError: 'Timeout of 30000ms exceeded' },
      ],
    },
  },
};

export const NeverRun: Story = {
  args: {
    health: {
      lastSweep: { FAST: null, HOURLY: null, DAILY: null },
      durationsMs: { FAST: null, HOURLY: null, DAILY: null },
      failingRules: [],
    },
  },
};

export const Loading: Story = { args: { health: undefined, loading: true } };

export const ErrorState: Story = {
  args: { health: undefined, error: true, onRetry: () => undefined },
};

export const Phone: Story = {
  ...TwoFailingRules,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
