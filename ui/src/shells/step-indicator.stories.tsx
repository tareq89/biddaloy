import type { Meta, StoryObj } from '@storybook/react-vite';

import { StepIndicator } from './step-indicator';

const steps = [
  { id: 'kind', label: 'Kind' },
  { id: 'details', label: 'Details' },
  { id: 'review', label: 'Review' },
];

const meta: Meta<typeof StepIndicator> = {
  title: 'Shells/StepIndicator',
  component: StepIndicator,
  tags: ['autodocs'],
  args: { steps, currentStepId: 'details', onStepChange: () => {}, label: 'Steps' },
};
export default meta;
type Story = StoryObj<typeof StepIndicator>;

export const Middle: Story = {};
export const First: Story = { args: { currentStepId: 'kind' } };
export const ReadOnly: Story = {
  render: (args) => <StepIndicator steps={args.steps} currentStepId={args.currentStepId} />,
};
