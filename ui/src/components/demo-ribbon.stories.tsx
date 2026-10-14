import type { Meta, StoryObj } from '@storybook/react-vite';

import { DemoRibbon } from './demo-ribbon';

const meta = {
  title: 'Components/DemoRibbon',
  component: DemoRibbon,
  args: { label: 'Demo school' },
  decorators: [
    (Story) => (
      <div className="relative h-40 w-full bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DemoRibbon>;
export default meta;

export const Default: StoryObj<typeof meta> = {};
