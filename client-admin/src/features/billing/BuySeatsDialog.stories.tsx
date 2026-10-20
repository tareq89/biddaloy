import type { Meta, StoryObj } from '@storybook/react-vite';

import { summaryFree } from './billing-fixtures';
import { BuySeatsDialog } from './BuySeatsDialog';

const meta: Meta<typeof BuySeatsDialog> = {
  component: BuySeatsDialog,
  args: { open: true, initialSeats: 300, onOpenChange: () => undefined, onSubmit: () => undefined },
};
export default meta;

type Story = StoryObj<typeof BuySeatsDialog>;

export const Default: Story = {};
export const SeatLimitReached: Story = { args: { limitReached: true } };
export const Submitting: Story = { args: { pending: true } };
export const Failed: Story = { args: { failed: true } };
export const Created: Story = { args: { created: summaryFree.orders[0] } };
export const CreatedWithPay: Story = {
  args: { created: summaryFree.orders[0], onPay: () => undefined },
};
export const PayStarting: Story = {
  args: { created: summaryFree.orders[0], onPay: () => undefined, paying: true },
};
export const PayFailed: Story = {
  args: { created: summaryFree.orders[0], onPay: () => undefined, payFailed: true },
};
