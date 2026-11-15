import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { FieldPicker, type FieldPickerProps } from './field-picker';

const GROUPS_EN = {
  child: 'The child',
  parents: 'Parents',
  guardian: 'Guardian',
  address: 'Address',
  previous: 'Previous school',
  quota: 'Quota',
  other: 'Other',
};
const GROUPS_BN = {
  child: 'শিশু',
  parents: 'বাবা-মা',
  guardian: 'অভিভাবক',
  address: 'ঠিকানা',
  previous: 'আগের স্কুল',
  quota: 'কোটা',
  other: 'অন্যান্য',
};

function Controlled(props: Omit<FieldPickerProps, 'value' | 'onChange'> & { initial?: string[] }) {
  const [value, setValue] = React.useState<string[]>(props.initial ?? ['name', 'dob']);
  return <FieldPicker {...props} value={value} onChange={setValue} />;
}

const meta: Meta<typeof Controlled> = {
  title: 'Components/FieldPicker',
  component: Controlled,
  tags: ['autodocs'],
  args: {
    locale: 'en',
    groupLabels: GROUPS_EN,
    searchLabel: 'Search fields',
    recommendedLabel: 'Recommended',
    noMatchText: 'No field matches.',
    countLabel: (n: number) => `${n} selected`,
    recommended: ['name', 'dob', 'gender', 'father_name'],
  },
};

export default meta;
type Story = StoryObj<typeof Controlled>;

export const Default: Story = {};
export const NothingTicked: Story = { args: { initial: [] } };
export const Dark: Story = { globals: { theme: 'dark' } };
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
export const Bangla: Story = {
  args: {
    locale: 'bn',
    groupLabels: GROUPS_BN,
    searchLabel: 'ঘর খুঁজুন',
    recommendedLabel: 'প্রস্তাবিত',
    noMatchText: 'কোনো ঘর মেলেনি।',
    countLabel: (n: number) => `${n}টা বাছা হয়েছে`,
  },
};
