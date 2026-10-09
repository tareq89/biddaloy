import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { MultiCombobox, type MultiComboboxOption } from './multi-combobox';

const meta: Meta<typeof MultiCombobox> = {
  title: 'Components/MultiCombobox',
  component: MultiCombobox,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof MultiCombobox>;

const CLASS_OPTIONS: MultiComboboxOption[] = [
  { value: 'six', label: 'Six' },
  { value: 'seven', label: 'Seven' },
  { value: 'eight', label: 'Eight' },
];

const PEOPLE_OPTIONS: MultiComboboxOption[] = [
  { value: 'u1', label: 'রহিম উদ্দিন', description: 'শিক্ষক' },
  { value: 'u2', label: 'করিম আহমেদ', description: 'হিসাবরক্ষক' },
  { value: 'r1', label: 'সব প্রধান শিক্ষক', description: 'ভূমিকা' },
];

function Demo({
  options = CLASS_OPTIONS,
  initial = [],
  max,
}: {
  options?: MultiComboboxOption[];
  initial?: string[];
  max?: number;
}) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <MultiCombobox
      aria-label="Class"
      options={options}
      value={value}
      onValueChange={setValue}
      placeholder="Search…"
      max={max}
    />
  );
}

export const Empty: Story = { render: () => <Demo /> };

export const WithSelection: Story = { render: () => <Demo initial={['six', 'eight']} /> };

export const WithDescriptions: Story = {
  render: () => <Demo options={PEOPLE_OPTIONS} initial={['u1']} />,
};

export const MaxReached: Story = { render: () => <Demo initial={['six']} max={1} /> };

export const Bangla: Story = {
  render: () => (
    <Demo
      options={[
        { value: 'six', label: 'ষষ্ঠ' },
        { value: 'seven', label: 'সপ্তম' },
        { value: 'eight', label: 'অষ্টম' },
      ]}
      initial={['six']}
    />
  ),
  decorators: [rtlDecorator],
};
