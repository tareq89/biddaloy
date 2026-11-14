import type { Meta, StoryObj } from '@storybook/react-vite';

import { PackageCard } from './package-card';

const meta: Meta<typeof PackageCard> = {
  title: 'Components/PackageCard',
  component: PackageCard,
  tags: ['autodocs'],
  args: {
    name: 'Starter',
    smsCount: '1,000 SMS',
    priceLabel: '৳ 500',
    validityLabel: 'Valid for 12 months',
    buyLabel: 'Buy',
    onBuy: () => undefined,
  },
};

export default meta;
type Story = StoryObj<typeof PackageCard>;

export const Default: Story = {};
export const Busy: Story = { args: { busy: true } };
export const Disabled: Story = { args: { disabledReason: 'Pay the outstanding bill first.' } };
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
export const Bangla: Story = {
  args: {
    name: 'শুরুর প্যাকেজ',
    smsCount: '১,০০০ এসএমএস',
    priceLabel: '৳ ৫০০',
    validityLabel: '১২ মাস মেয়াদ',
    buyLabel: 'কিনুন',
  },
};
