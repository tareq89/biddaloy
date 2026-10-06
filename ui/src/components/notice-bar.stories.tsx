import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './button';
import { NoticeBar } from './notice-bar';

const meta: Meta<typeof NoticeBar> = {
  title: 'Components/NoticeBar',
  component: NoticeBar,
  tags: ['autodocs'],
  args: {
    tone: 'info',
    children: 'Your free trial ends in 12 days.',
    action: (
      <Button size="sm" variant="outline">
        Choose a plan
      </Button>
    ),
  },
};

export default meta;
type Story = StoryObj<typeof NoticeBar>;

export const Info: Story = {};
export const Warning: Story = {
  args: { tone: 'warning', children: 'Your free trial ends in 3 days.' },
};
export const Danger: Story = {
  args: { tone: 'danger', children: 'Your free trial ended. Choose a plan to keep your data.' },
};
/** One truncated line; the whole bar is the details button. */
export const Phone: Story = {
  args: {
    tone: 'warning',
    children: 'Your free trial ends in 3 days. Choose a plan to keep using Biddaloy.',
    onOpenDetails: () => undefined,
  },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
