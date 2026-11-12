import type { Meta, StoryObj } from '@storybook/react-vite';

import { ActionLinesCard, type ActionLine } from './action-lines-card';

const line = (tone: ActionLine['tone'], text: string, label: string): ActionLine => ({
  id: tone,
  tone,
  text,
  action: { label, onClick: () => undefined },
});

const meta: Meta<typeof ActionLinesCard> = {
  title: 'Components/ActionLinesCard',
  component: ActionLinesCard,
  tags: ['autodocs'],
  args: {
    title: 'What to do next',
    emptyText: 'Nothing needs your attention.',
    lines: [
      line('danger', 'Two schools have no messages left.', 'Review'),
      line('warning', 'One package expires in 5 days.', 'Open'),
      line('neutral', 'A new package is available.', 'See'),
    ],
  },
};

export default meta;
type Story = StoryObj<typeof ActionLinesCard>;

export const Default: Story = {};
export const Danger: Story = { args: { lines: [line('danger', 'No messages left.', 'Review')] } };
export const Warning: Story = { args: { lines: [line('warning', 'Expires in 5 days.', 'Open')] } };
export const Neutral: Story = {
  args: { lines: [line('neutral', 'A new package is available.', 'See')] },
};
export const Empty: Story = { args: { lines: [] } };
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
export const Bangla: Story = {
  args: {
    title: 'এখন কী করবেন',
    emptyText: 'কোনো কাজ বাকি নেই।',
    lines: [line('warning', 'একটি প্যাকেজের মেয়াদ ৫ দিনে শেষ হবে।', 'খুলুন')],
  },
};
