import type { Meta, StoryObj } from '@storybook/react-vite';

import { summaryEmpty, summaryExpiring, summaryFree } from './billing-fixtures';
import { SeatsBillingSectionView } from './SeatsBillingSectionView';

const meta: Meta<typeof SeatsBillingSectionView> = {
  component: SeatsBillingSectionView,
  args: {
    loading: false,
    now: new Date('2026-10-20T00:00:00Z'),
    onBuy: () => undefined,
    onRetry: () => undefined,
  },
};
export default meta;

type Story = StoryObj<typeof SeatsBillingSectionView>;

export const Loading: Story = { args: { loading: true } };
export const LoadError: Story = { args: { error: true } };
export const FreePeriodNoOrders: Story = { args: { summary: summaryEmpty } };
export const FreePeriodWithPendingOrder: Story = { args: { summary: summaryFree } };
export const Expiring: Story = {
  args: { summary: summaryExpiring, now: new Date('2027-03-01T00:00:00Z') },
};
export const Expired: Story = {
  args: { summary: summaryExpiring, now: new Date('2027-05-01T00:00:00Z') },
};
