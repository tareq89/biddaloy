import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Textarea } from './textarea';

const meta: Meta<typeof Textarea> = {
  title: 'Components/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  args: { 'aria-label': 'Reminder message', placeholder: 'Type a message…' },
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: { defaultValue: 'Dear {{guardian_name}}, {{student_name}} has an outstanding due.' },
};

/** No value entered yet — the state a required field starts in. */
export const Empty: Story = {};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Dear {{guardian_name}}…' },
};

/** Stands in for this issue's "error" state category. Real error text and
 * `aria-describedby` linkage belong to `FormField` ([8.6.3]), which
 * composes this — a bare `Textarea` only carries the visual/`aria-invalid`
 * half of that contract. */
export const InvalidValue: Story = {
  args: { 'aria-invalid': true, defaultValue: '' },
};

/** `Textarea` has no loading state of its own — see `Input`'s story for
 * the same reasoning. `readOnly` + a "Loading…" placeholder is the
 * closest single-component analog. */
export const Loading: Story = {
  args: { readOnly: true, placeholder: 'Loading…', defaultValue: '' },
};

export const RightToLeft: Story = {
  args: {
    'aria-label': 'রিমাইন্ডার বার্তা',
    placeholder: 'একটি বার্তা লিখুন…',
    defaultValue: 'প্রিয় {{guardian_name}}, {{student_name}}-এর বকেয়া রয়েছে।',
  },
  decorators: [rtlDecorator],
};
