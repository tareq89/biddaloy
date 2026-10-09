import type { Meta, StoryObj } from '@storybook/react-vite';

import { FilterSheet } from './filter-sheet';
import { Input } from './input';
import { Label } from './label';

const meta: Meta<typeof FilterSheet> = {
  title: 'Components/FilterSheet',
  component: FilterSheet,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  args: { open: true, onOpenChange: () => {}, onClearAll: () => {}, resultCount: 48 },
  render: (args) => (
    <FilterSheet {...args}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fs-name">Name</Label>
        <Input id="fs-name" className="w-full" />
      </div>
    </FilterSheet>
  ),
};

export default meta;
type Story = StoryObj<typeof FilterSheet>;

export const Default: Story = {};
export const UnknownCount: Story = {
  render: (args) => (
    <FilterSheet open onOpenChange={args.onOpenChange} onClearAll={args.onClearAll}>
      <p className="text-body">Fields go here.</p>
    </FilterSheet>
  ),
};
