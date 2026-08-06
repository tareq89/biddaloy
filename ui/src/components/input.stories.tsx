import type { Meta, StoryObj } from '@storybook/react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Input } from './input';

const meta: Meta<typeof Input> = {
  title: 'Components/Input',
  component: Input,
  tags: ['autodocs'],
  args: { 'aria-label': 'Student name', placeholder: 'Full name' },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: { defaultValue: 'Rahim Uddin' },
};

/** No value entered yet — the state a required field starts in. */
export const Empty: Story = {};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Rahim Uddin' },
};

/** Stands in for this issue's "error" state category. Real error text and
 * `aria-describedby` linkage belong to `FormField` ([8.6.3]), which
 * composes this — a bare `Input` only carries the visual/`aria-invalid`
 * half of that contract. */
export const InvalidValue: Story = {
  args: { 'aria-invalid': true, defaultValue: '123' },
};

/** `Input` has no loading state of its own — a pending async value (a
 * lookup-populated field, say) is a `FormField`/form-level concern, not
 * something this bare control models. `readOnly` + a "Loading…"
 * placeholder is the closest single-component analog. */
export const Loading: Story = {
  args: { readOnly: true, placeholder: 'Loading…', defaultValue: '' },
};

export const RightToLeft: Story = {
  args: { 'aria-label': 'শিক্ষার্থীর নাম', placeholder: 'পুরো নাম', defaultValue: 'রহিম উদ্দিন' },
  decorators: [rtlDecorator],
};
