import type { Meta, StoryObj } from '@storybook/react-vite';

import { NextActionCard } from './next-action-card';

const meta: Meta<typeof NextActionCard> = {
  title: 'Components/NextActionCard',
  component: NextActionCard,
  tags: ['autodocs'],
  args: {
    title: 'Publish the merit list',
    description: 'Parents can see the result after you publish it.',
    action: { label: 'Publish', onClick: () => undefined },
    secondary: { label: 'See the list first', onClick: () => undefined },
    doneLabel: 'Done',
  },
};

export default meta;
type Story = StoryObj<typeof NextActionCard>;

export const Default: Story = {};
export const Done: Story = { args: { done: true } };
export const Dark: Story = { globals: { theme: 'dark' } };
export const DoneDark: Story = { args: { done: true }, globals: { theme: 'dark' } };
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
export const Bangla: Story = {
  args: {
    title: 'মেধাতালিকা প্রকাশ করুন',
    description: 'প্রকাশ করলে অভিভাবকরা ফল দেখতে পাবেন।',
    action: { label: 'প্রকাশ করুন', onClick: () => undefined },
    secondary: { label: 'আগে তালিকা দেখুন', onClick: () => undefined },
  },
};
