import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

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

/**
 * [8.13.10] Proves the open animation is genuinely live, not merely present
 * as class names. Before this ticket, `MenuContent`'s
 * `animate-in`/`zoom-in-95`/`slide-in-from-*` classes compiled to nothing —
 * `tw-animate-css` was not installed — so every menu opened with a snap
 * despite the "correct-looking" shadcn class strings. `play()` opens the
 * menu for real and reads the *computed* `animationDuration` back: the
 * DOM-truth check a source read (or a class-string unit test) cannot do,
 * same rationale as `check-contrast.mjs`'s compiled-output guard for this
 * ticket (contract §7).
 */
export const OpenAnimation: Story = {
  render: () => (
    <Menu>
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Row actions' }));
    const content = await canvas.findByRole('menu');
    const animationDuration = getComputedStyle(content).animationDuration;
    // An unrecognised utility (the pre-[8.13.10] state) computes to "0s".
    // Contract §7's dropdown/popover/select/tooltip duration is 180ms,
    // which the CSS OM serialises as "0.18s".
    await expect(animationDuration).not.toBe('0s');
    await expect(animationDuration).toBe('0.18s');
  },
};
