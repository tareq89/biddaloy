import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';
import { REGION_BD_EN } from '../utils/region-config';

import { PhoneInput } from './phone-input';

const meta: Meta<typeof PhoneInput> = {
  title: 'Components/PhoneInput',
  component: PhoneInput,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof PhoneInput>;

function Demo({ initial = '', disabled = false }: { initial?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <PhoneInput
      aria-label="Phone"
      value={value}
      onValueChange={setValue}
      config={REGION_BD_EN}
      disabled={disabled}
    />
  );
}

export const Default: Story = {
  render: () => <Demo initial="1712345678" />,
};

/** No value entered yet — shows the region's own example as a placeholder. */
export const Empty: Story = {
  render: () => <Demo />,
};

export const Disabled: Story = {
  render: () => <Demo initial="1712345678" disabled />,
};

/** Stands in for this issue's "error" state category. */
export const Invalid: Story = {
  render: () => <Demo initial="9912345678" />,
};

export const RightToLeft: Story = {
  render: () => <Demo initial="1712345678" />,
  decorators: [rtlDecorator],
};
