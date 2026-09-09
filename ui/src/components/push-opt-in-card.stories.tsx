import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { PushOptInCard } from './push-opt-in-card';

const meta: Meta<typeof PushOptInCard> = {
  title: 'Components/PushOptInCard',
  component: PushOptInCard,
  tags: ['autodocs'],
  args: {
    onEnable: fn(),
    onDismiss: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof PushOptInCard>;

export const Default: Story = {};

export const Enabling: Story = {
  args: { enabling: true },
};

export const RTL: Story = {
  decorators: [rtlDecorator],
};
