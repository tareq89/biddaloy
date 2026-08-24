import type { Meta, StoryObj } from '@storybook/react-vite';

import { RouteAnnouncer } from './route-announcer';

const meta: Meta<typeof RouteAnnouncer> = {
  title: 'Components/RouteAnnouncer',
  component: RouteAnnouncer,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Invisible in every state — an `aria-live="polite"` region with no visual rendering. Inspect the accessibility tree (or a screen reader) to see its content change.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof RouteAnnouncer>;

export const Default: Story = {
  args: { message: 'Students' },
};

export const Empty: Story = {
  args: { message: null },
};
