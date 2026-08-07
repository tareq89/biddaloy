import type { Meta, StoryObj } from '@storybook/react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

const meta: Meta<typeof Select> = {
  title: 'Components/Select',
  component: Select,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Select>;

function ClassOptions() {
  return (
    <SelectContent>
      <SelectItem value="six">Six</SelectItem>
      <SelectItem value="seven">Seven</SelectItem>
      <SelectItem value="eight">Eight</SelectItem>
    </SelectContent>
  );
}

export const Default: Story = {
  render: () => (
    <Select defaultValue="six">
      <SelectTrigger aria-label="Class">
        <SelectValue />
      </SelectTrigger>
      <ClassOptions />
    </Select>
  ),
};

/** No value chosen yet. */
export const Empty: Story = {
  render: () => (
    <Select>
      <SelectTrigger aria-label="Class">
        <SelectValue placeholder="Select a class" />
      </SelectTrigger>
      <ClassOptions />
    </Select>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Select defaultValue="six" disabled>
      <SelectTrigger aria-label="Class">
        <SelectValue />
      </SelectTrigger>
      <ClassOptions />
    </Select>
  ),
};

/** Stands in for this issue's "error" state category. */
export const Invalid: Story = {
  render: () => (
    <Select>
      <SelectTrigger aria-label="Class" aria-invalid>
        <SelectValue placeholder="Select a class" />
      </SelectTrigger>
      <ClassOptions />
    </Select>
  ),
};

/** No dedicated "Loading" story: an async option list (fetched classes)
 * is `Combobox` territory ([8.6.3]) — this `Select` is for a short, static,
 * already-available list, so it has nothing distinct to show mid-fetch. */

export const RightToLeft: Story = {
  render: () => (
    <Select defaultValue="six">
      <SelectTrigger aria-label="শ্রেণি">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="six">ষষ্ঠ</SelectItem>
        <SelectItem value="seven">সপ্তম</SelectItem>
        <SelectItem value="eight">অষ্টম</SelectItem>
      </SelectContent>
    </Select>
  ),
  decorators: [rtlDecorator],
};
