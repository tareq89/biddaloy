import type { Meta, StoryObj } from '@storybook/react-vite';

import { StepIndicator } from './step-indicator';

const steps = [
  { id: 'account', label: 'Account' },
  { id: 'details', label: 'School details' },
  { id: 'verify', label: 'Verify' },
];

const meta: Meta<typeof StepIndicator> = {
  title: 'Components/StepIndicator',
  component: StepIndicator,
  tags: ['autodocs'],
  args: { steps, current: 'details', progressLabel: 'Step 2 of 3' },
};

export default meta;
type Story = StoryObj<typeof StepIndicator>;

export const Middle: Story = {};
export const First: Story = { args: { current: 'account', progressLabel: 'Step 1 of 3' } };
export const Last: Story = { args: { current: 'verify', progressLabel: 'Step 3 of 3' } };
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
