import type { Meta, StoryObj } from '@storybook/react-vite';
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

const meta: Meta<typeof ChoiceCards> = {
  title: 'Components/ChoiceCards',
  component: ChoiceCards,
  tags: ['autodocs'],
  args: { label: 'Certificate kind', options, value: 'testimonial', onValueChange: () => {} },
  render: (args) => {
    const [value, setValue] = React.useState(args.value);
    return <ChoiceCards {...args} value={value} onValueChange={setValue} />;
  },
};
export default meta;
type Story = StoryObj<typeof ChoiceCards>;

export const Default: Story = {};
export const ThreeColumns: Story = { args: { columns: 3 } };
export const NothingSelected: Story = { args: { value: undefined } };
