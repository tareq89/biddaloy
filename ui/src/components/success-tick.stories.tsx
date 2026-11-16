import type { Meta, StoryObj } from '@storybook/react-vite';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';

import { SuccessTick } from './success-tick';

const meta: Meta<typeof SuccessTick> = {
  title: 'Components/SuccessTick',
  component: SuccessTick,
  tags: ['autodocs'],
  args: { label: 'Payment received' },
};

export default meta;
type Story = StoryObj<typeof SuccessTick>;

export const Light: Story = {};

export const Dark: Story = {
  tags: ['!autodocs'],
  decorators: [darkDecorator],
  parameters: darkDecoratorParameters,
};
