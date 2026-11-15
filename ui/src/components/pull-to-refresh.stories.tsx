import type { Meta, StoryObj } from '@storybook/react-vite';

import { PullToRefresh } from './pull-to-refresh';

const meta: Meta<typeof PullToRefresh> = {
  title: 'Components/PullToRefresh',
  component: PullToRefresh,
  tags: ['autodocs'],
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

export default meta;
type Story = StoryObj<typeof PullToRefresh>;

/** Drag down from the top with touch emulation (pointer: coarse); on a
 * mouse-only browser the list renders unchanged. */
export const Default: Story = {
  args: {
    label: 'Refreshing',
    onRefresh: () => new Promise((resolve) => setTimeout(resolve, 1200)),
    children: (
      <ul className="divide-y">
        {Array.from({ length: 12 }, (_, i) => (
          <li key={i} className="p-3">
            Student {i + 1}
          </li>
        ))}
      </ul>
    ),
  },
};
