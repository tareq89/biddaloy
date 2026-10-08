import type { Meta, StoryObj } from '@storybook/react-vite';

import { Stepper } from './step-indicator';

const steps = [
  { id: 'account', label: 'Account' },
  { id: 'details', label: 'School details' },
  { id: 'verify', label: 'Verify' },
];

const meta: Meta<typeof Stepper> = {
  title: 'Components/Stepper',
  component: Stepper,
  tags: ['autodocs'],
  args: { steps, current: 'details', progressLabel: 'Step 2 of 3', label: 'Steps' },
};

export default meta;
type Story = StoryObj<typeof Stepper>;

export const Middle: Story = {};
export const First: Story = { args: { current: 'account', progressLabel: 'Step 1 of 3' } };
export const Last: Story = { args: { current: 'verify', progressLabel: 'Step 3 of 3' } };
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
