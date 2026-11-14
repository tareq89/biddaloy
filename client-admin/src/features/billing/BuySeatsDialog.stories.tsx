import { SeatOrderStatus } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';


import { summaryFree } from './billing-fixtures';
import { BuySeatsDialog } from './BuySeatsDialog';

const meta: Meta<typeof BuySeatsDialog> = {
  component: BuySeatsDialog,
  args: {
    open: true,
    initialSeats: 300,
    unitPricePaisa: 1000,
    onOpenChange: () => undefined,
    onSubmit: () => undefined,
  },
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

// The dialog renders in a portal, so the play step queries the whole body.
async function applyCode(code: string) {
  const body = within(document.body);
  await userEvent.click(await body.findByRole('button', { name: /have a coupon|কুপন আছে/i }));
  await userEvent.type(await body.findByLabelText(/coupon code|কুপন কোড/i), code);
  await userEvent.click(body.getByRole('button', { name: /apply|প্রয়োগ/i }));
}

export const CouponOpen: Story = { args: { openCoupon: true } };
export const CouponApplied: Story = { play: () => applyCode('HALF') };
export const CouponFailed: Story = { play: () => applyCode('NOPE1') };
export const CouponFree: Story = { play: () => applyCode('FREE') };
export const CouponRejectedOnSubmit: Story = { args: { openCoupon: true, couponRejected: true } };
export const CreatedFree: Story = {
  args: {
    created: { ...summaryFree.orders[0]!, status: SeatOrderStatus.PAID, amount_paisa: 0 },
    onReceipt: () => undefined,
    onPay: () => undefined,
  },
};
