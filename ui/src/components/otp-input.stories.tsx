import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { OtpInput } from './otp-input';

const meta: Meta<typeof OtpInput> = {
  title: 'Components/OtpInput',
  component: OtpInput,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof OtpInput>;

function Demo({
  initial = '',
  ...props
}: Partial<ComponentProps<typeof OtpInput>> & { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <OtpInput
      id="otp-demo"
      aria-label="6-digit code"
      value={value}
      onValueChange={setValue}
      {...props}
    />
  );
}

export const Default: Story = {
  render: () => <Demo />,
};

export const Filled: Story = {
  render: () => <Demo initial="123456" />,
};

export const Invalid: Story = {
  render: () => <Demo initial="000000" invalid />,
};

export const Disabled: Story = {
  render: () => <Demo initial="123456" disabled />,
};

/** No dedicated "Loading" story: this is a bare, uncontrolled-by-network
 * field — `/forgot-password` owns the request/resend state around it, not
 * this component. */

export const RightToLeft: Story = {
  render: () => <Demo aria-label="৬-সংখ্যার কোড" />,
  decorators: [rtlDecorator],
};
