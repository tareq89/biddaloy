import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';

import { CouponRow } from './CouponRow';

const meta: Meta<typeof CouponRow> = {
  component: CouponRow,
  args: { seats: 50, months: 3, onApplied: fn() },
};
export default meta;

type Story = StoryObj<typeof CouponRow>;

async function applyCode(canvasElement: HTMLElement, code: string) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: /coupon/i }));
  await userEvent.type(await canvas.findByLabelText(/coupon code|কুপন কোড/i), code);
  await userEvent.click(canvas.getByRole('button', { name: /apply|প্রয়োগ/i }));
}

export const Collapsed: Story = {};
export const Open: Story = { args: { defaultOpen: true } };
/** The server's one sentence; the mock answers 400 for any code but HALF and FREE. */
export const Failed: Story = { play: ({ canvasElement }) => applyCode(canvasElement, 'NOPE1') };
export const RejectedOnSubmit: Story = { args: { rejected: true } };
