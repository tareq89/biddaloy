import type { Meta, StoryObj } from '@storybook/react';
import { useState, type ComponentProps } from 'react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';
import { REGION_BD_BN, REGION_BD_EN } from '../i18n/region-config';

import { MoneyInput } from './money-input';

const meta: Meta<typeof MoneyInput> = {
  title: 'Components/MoneyInput',
  component: MoneyInput,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof MoneyInput>;

function Demo({
  config = REGION_BD_EN,
  initial,
  ...props
}: Partial<ComponentProps<typeof MoneyInput>> & { initial?: number }) {
  const [value, setValue] = useState<number | undefined>(initial);
  return (
    <MoneyInput
      aria-label="Amount"
      value={value}
      onValueChange={setValue}
      config={config}
      {...props}
    />
  );
}

export const Default: Story = {
  render: () => <Demo initial={12345600} />,
};

/** No value entered yet. */
export const Empty: Story = {
  render: () => <Demo />,
};

export const Disabled: Story = {
  render: () => <Demo initial={50000} disabled />,
};

/** Stands in for this issue's "error" state category. */
export const Invalid: Story = {
  render: () => <Demo initial={-10000} aria-invalid />,
};

/** No dedicated "Loading" story: a money amount is either present or not —
 * there's no async fetch inside this bare control for it to model a
 * pending state for. */

export const RightToLeft: Story = {
  render: () => <Demo config={REGION_BD_BN} initial={12345600} aria-label="পরিমাণ" />,
  decorators: [rtlDecorator],
};
