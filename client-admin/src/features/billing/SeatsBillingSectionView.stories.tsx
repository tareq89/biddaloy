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
    onReceipt: () => undefined,
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

const pendingId = summaryFree.orders[0]!.id;
export const ReturnPaid: Story = {
  args: {
    summary: summaryExpiring,
    returnOrderId: summaryExpiring.orders[0]!.id,
    payment: 'success',
  },
};
export const ReturnConfirming: Story = {
  args: { summary: summaryFree, returnOrderId: pendingId, payment: 'success' },
};
export const ReturnStillWaiting: Story = {
  args: { summary: summaryFree, returnOrderId: pendingId, payment: 'success', pollTimedOut: true },
};
export const ReturnCancelled: Story = {
  args: { summary: summaryFree, returnOrderId: pendingId, payment: 'cancel' },
};
export const ReturnError: Story = { args: { summary: summaryFree, payment: 'error' } };
export const ReceiptOpenFailed: Story = {
  args: { summary: summaryExpiring, now: new Date('2027-03-01T00:00:00Z'), receiptError: true },
};
