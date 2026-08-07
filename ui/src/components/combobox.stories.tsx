import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Combobox, type ComboboxOption } from './combobox';

const meta: Meta<typeof Combobox> = {
  title: 'Components/Combobox',
  component: Combobox,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Combobox>;

const CLASS_OPTIONS: ComboboxOption[] = [
  { value: 'six', label: 'Six' },
  { value: 'seven', label: 'Seven' },
  { value: 'eight', label: 'Eight' },
];

function Demo({
  options = CLASS_OPTIONS,
  initial = null,
}: {
  options?: ComboboxOption[];
  initial?: string | null;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <Combobox
      aria-label="Class"
      options={options}
      value={value}
      onValueChange={setValue}
      placeholder="Search…"
    />
  );
}

export const Default: Story = {
  render: () => <Demo initial="six" />,
};

/** No option chosen yet. */
export const Empty: Story = {
  render: () => <Demo />,
};

/** Stands in for this issue's "error" state category — no options
 * available for a filter query, an empty-search-result form of error. */
export const NoResults: Story = {
  render: () => <Demo options={[]} />,
};

/** No dedicated "Disabled"/"Loading" story: the composed `Input`'s
 * `disabled` prop (already covered in `input.stories.tsx`) applies
 * unchanged; an async-loaded option list (fetched classes, say) is a
 * caller concern — this `Combobox` filters whatever `options` it's given,
 * synchronously. */

export const RightToLeft: Story = {
  render: () => (
    <Demo
      options={[
        { value: 'six', label: 'ষষ্ঠ' },
        { value: 'seven', label: 'সপ্তম' },
        { value: 'eight', label: 'অষ্টম' },
      ]}
      initial="six"
    />
  ),
  decorators: [rtlDecorator],
};
