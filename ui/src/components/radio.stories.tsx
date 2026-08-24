/** No "Loading" or "Empty" story: a radio group always has a value once
 * rendered (or none selected, which `Default` already shows) — there's no
 * separate loading state at this bare-control layer, same reasoning as
 * `checkbox.stories.tsx`. */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { RadioGroup, RadioGroupItem } from './radio';

const meta: Meta<typeof RadioGroup> = {
  title: 'Components/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof RadioGroup>;

// See `radio.test.tsx`'s comment: `RadioGroupItem` is a `<button
// role="radio">`, so each option gets its own `aria-label` rather than a
// `<label>` wrapper, which doesn't create a real association for a button.
function Options({ disabled = false }: { disabled?: boolean }) {
  return (
    <>
      <span>
        <RadioGroupItem value="sms" aria-label="SMS" disabled={disabled} /> SMS
      </span>
      <span>
        <RadioGroupItem value="email" aria-label="Email" disabled={disabled} /> Email
      </span>
      <span>
        <RadioGroupItem value="call" aria-label="Call" disabled={disabled} /> Call
      </span>
    </>
  );
}

export const Default: Story = {
  args: { 'aria-label': 'Preferred communication', defaultValue: 'sms' },
  render: (args) => (
    <RadioGroup {...args}>
      <Options />
    </RadioGroup>
  ),
};

export const Disabled: Story = {
  args: { 'aria-label': 'Preferred communication', defaultValue: 'sms', disabled: true },
  render: (args) => (
    <RadioGroup {...args}>
      <Options disabled />
    </RadioGroup>
  ),
};

/** Stands in for this issue's "error" state category. */
export const Invalid: Story = {
  args: { 'aria-label': 'Preferred communication', 'aria-invalid': true },
  render: (args) => (
    <RadioGroup {...args}>
      <Options />
    </RadioGroup>
  ),
};

export const RightToLeft: Story = {
  args: { 'aria-label': 'পছন্দের যোগাযোগ মাধ্যম', defaultValue: 'sms' },
  render: (args) => (
    <RadioGroup {...args}>
      <span>
        <RadioGroupItem value="sms" aria-label="এসএমএস" /> এসএমএস
      </span>
      <span>
        <RadioGroupItem value="email" aria-label="ইমেইল" /> ইমেইল
      </span>
      <span>
        <RadioGroupItem value="call" aria-label="কল" /> কল
      </span>
    </RadioGroup>
  ),
  decorators: [rtlDecorator],
};
