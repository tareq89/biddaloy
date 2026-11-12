import type { Meta, StoryObj } from '@storybook/react-vite';

import { LotExpiryList } from './lot-expiry-list';

const meta: Meta<typeof LotExpiryList> = {
  title: 'Components/LotExpiryList',
  component: LotExpiryList,
  tags: ['autodocs'],
  args: {
    noExpiryLabel: 'No expiry',
    soonLabel: 'Expires soon',
    emptyText: 'No purchases yet.',
    rows: [
      { id: 'a', remainingLabel: '120 left', expiryLabel: '5 Dec 2026', soon: true },
      { id: 'b', remainingLabel: '800 left', expiryLabel: '1 Mar 2027' },
      { id: 'c', remainingLabel: '50 left', expiryLabel: null },
    ],
  },
};

export default meta;
type Story = StoryObj<typeof LotExpiryList>;

export const Default: Story = {};
export const Empty: Story = { args: { rows: [] } };
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
export const Bangla: Story = {
  args: {
    noExpiryLabel: 'মেয়াদ নেই',
    soonLabel: 'শিগগিরই শেষ হবে',
    emptyText: 'এখনো কেনা হয়নি।',
    rows: [
      { id: 'a', remainingLabel: '১২০ বাকি', expiryLabel: '৫ ডিসেম্বর ২০২৬', soon: true },
      { id: 'c', remainingLabel: '৫০ বাকি', expiryLabel: null },
    ],
  },
};
