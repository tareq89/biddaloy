import type { Meta, StoryObj } from '@storybook/react-vite';
import { Copy, FileText, Plus } from 'lucide-react';
import * as React from 'react';

import { ChoiceCards } from './choice-cards';

const options = [
  { value: 'testimonial', title: 'Testimonial', description: 'General certificate' },
  { value: 'character', title: 'Character', description: 'Conduct certificate' },
  {
    value: 'tc',
    title: 'Transfer',
    disabled: true,
    disabledReason: 'Record a leaving event first',
  },
];

function Controlled(args: React.ComponentProps<typeof ChoiceCards>) {
  const [value, setValue] = React.useState(args.value);
  return <ChoiceCards {...args} value={value} onValueChange={setValue} />;
}

const meta: Meta<typeof ChoiceCards> = {
  title: 'Components/ChoiceCards',
  component: ChoiceCards,
  tags: ['autodocs'],
  args: { label: 'Certificate kind', options, value: 'testimonial', onValueChange: () => {} },
  render: (args) => <Controlled {...args} />,
};
export default meta;
type Story = StoryObj<typeof ChoiceCards>;

export const Default: Story = {};
export const ThreeColumns: Story = { args: { columns: 3 } };
export const NothingSelected: Story = { args: { value: undefined } };

const iconOptions = [
  { value: 'scratch', title: 'Start from scratch', description: 'A blank plan', icon: Plus },
  { value: 'template', title: 'Use a template', description: 'Pick a ready plan', icon: FileText },
  { value: 'copy', title: 'Copy last year', description: 'Reuse and adjust', icon: Copy },
];

export const WithIcons: Story = {
  args: { label: 'How do you want to start?', options: iconOptions, value: 'scratch', columns: 3 },
};
export const WithIconsPhone390: Story = {
  args: { label: 'How do you want to start?', options: iconOptions, value: 'scratch' },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
