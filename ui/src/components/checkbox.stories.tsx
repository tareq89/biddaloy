/**
 * No "Loading" story: a checkbox has no loading state of its own — a
 * pending async toggle (an optimistic-update-in-flight checkbox) is a
 * call-site concern (disable it while pending), not something this bare
 * control models differently from `Disabled`.
 */
import type { Meta, StoryObj } from '@storybook/react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Checkbox } from './checkbox';

const meta: Meta<typeof Checkbox> = {
  title: 'Components/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  args: { 'aria-label': 'Send SMS reminders' },
};

export default meta;
type Story = StoryObj<typeof Checkbox>;

export const Default: Story = {};

export const Checked: Story = {
  args: { defaultChecked: true },
};

/** Stands in for this issue's "empty" state category — `indeterminate` is
 * the tri-state case, the closest analog `Checkbox` has to "neither set
 * nor unset". */
export const Indeterminate: Story = {
  args: { checked: 'indeterminate' },
};

export const Disabled: Story = {
  args: { disabled: true },
};

/** Stands in for this issue's "error" state category. */
export const Invalid: Story = {
  args: { 'aria-invalid': true },
};

export const RightToLeft: Story = {
  args: { 'aria-label': 'এসএমএস অনুস্মারক পাঠান' },
  decorators: [rtlDecorator],
};
