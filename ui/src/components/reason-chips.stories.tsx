import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { ReasonChips, type ReasonChipsProps } from './reason-chips';

function Stateful(props: Omit<ReasonChipsProps, 'onChange'>) {
  const [value, setValue] = React.useState(props.value);
  return <ReasonChips {...props} value={value} onChange={setValue} />;
}

const meta = {
  title: 'Components/ReasonChips',
  component: Stateful,
  args: {
    chips: ['Parent request', 'Bug report', 'Training'],
    textLabel: 'Reason',
    minLength: 10,
    error: 'Write at least 10 characters',
    value: '',
  },
} satisfies Meta<typeof Stateful>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Picked: Story = { args: { value: 'Parent request' } };
export const ErrorShown: Story = { args: { value: 'abc' } };
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
export const Bangla: Story = {
  args: {
    chips: ['অভিভাবকের অনুরোধ', 'ত্রুটির প্রতিবেদন'],
    textLabel: 'কারণ',
    error: 'কমপক্ষে ১০ অক্ষর লিখুন',
    value: 'কম',
  },
};
