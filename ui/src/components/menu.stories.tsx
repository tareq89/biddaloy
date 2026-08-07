import type { Meta, StoryObj } from '@storybook/react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Button } from './button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from './menu';

const meta: Meta<typeof Menu> = {
  title: 'Components/Menu',
  component: Menu,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Menu>;

export const Default: Story = {
  render: () => (
    <Menu defaultOpen>
      <MenuTrigger asChild>
        <Button iconOnly aria-label="Row actions">
          ⋮
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem>Edit</MenuItem>
        <MenuItem>Duplicate</MenuItem>
        <MenuSeparator />
        <MenuItem variant="destructive">Delete</MenuItem>
      </MenuContent>
    </Menu>
  ),
};

/** Stands in for this issue's "empty" state category — no actions
 * available for this row (every action was individually disabled by
 * permissions), which the menu should still show as a real, if
 * unsatisfying, state rather than rendering nothing. */
export const Empty: Story = {
  render: () => (
    <Menu defaultOpen>
      <MenuTrigger asChild>
        <Button iconOnly aria-label="Row actions">
          ⋮
        </Button>
      </MenuTrigger>
      <MenuContent>
        <div className="px-1.5 py-1 text-sm text-muted-foreground">No actions available</div>
      </MenuContent>
    </Menu>
  ),
};

export const DisabledItem: Story = {
  render: () => (
    <Menu defaultOpen>
      <MenuTrigger asChild>
        <Button iconOnly aria-label="Row actions">
          ⋮
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem>Edit</MenuItem>
        <MenuItem disabled>Delete (already refunded)</MenuItem>
      </MenuContent>
    </Menu>
  ),
};

/** No "Loading"/"Error" story: this `Menu`'s items are a static local
 * action list — there's no fetch in the loop for a wrapper at this layer
 * to model a pending or failed state for. */

export const RightToLeft: Story = {
  render: () => (
    <Menu defaultOpen>
      <MenuTrigger asChild>
        <Button iconOnly aria-label="সারির ক্রিয়া">
          ⋮
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem>সম্পাদনা করুন</MenuItem>
        <MenuSeparator />
        <MenuItem variant="destructive">মুছে ফেলুন</MenuItem>
      </MenuContent>
    </Menu>
  ),
  decorators: [rtlDecorator],
};
