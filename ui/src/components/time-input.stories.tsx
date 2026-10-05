import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { TimeInput, type TimeInputProps } from './time-input';

function Controlled({ value: initial, ...args }: TimeInputProps) {
  const [value, setValue] = React.useState(initial);
  return (
    <div className="w-56">
      <TimeInput {...args} value={value} onValueChange={setValue} />
    </div>
  );
}

const meta: Meta<typeof TimeInput> = {
  title: 'Components/TimeInput',
  component: TimeInput,
  tags: ['autodocs'],
  args: { 'aria-label': 'Start time' },
  render: (args) => <Controlled {...args} />,
};

export default meta;
type Story = StoryObj<typeof TimeInput>;

export const Empty: Story = { args: { value: undefined } };
export const Eight: Story = { args: { value: '08:00' } };
export const Step15: Story = { args: { value: '08:15', stepMinutes: 15 } };
