import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { MonthPicker, type MonthPickerProps } from './month-picker';

function Controlled({ value: initial, ...args }: MonthPickerProps) {
  const [value, setValue] = React.useState(initial);
  return (
    <div className="w-56">
      <MonthPicker {...args} value={value} onValueChange={setValue} />
    </div>
  );
}

const meta: Meta<typeof MonthPicker> = {
  title: 'Components/MonthPicker',
  component: MonthPicker,
  tags: ['autodocs'],
  args: { 'aria-label': 'Month' },
  render: (args) => <Controlled {...args} />,
};

export default meta;
type Story = StoryObj<typeof MonthPicker>;

export const Empty: Story = { args: { value: undefined, placeholder: 'Pick a month' } };
export const WithValue: Story = { args: { value: '2026-09' } };
export const WithMinMax: Story = { args: { value: '2026-09', min: '2026-06', max: '2026-12' } };
