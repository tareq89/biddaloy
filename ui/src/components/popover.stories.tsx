import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Button } from './button';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from './popover';

const meta: Meta<typeof Popover> = {
  title: 'Components/Popover',
  component: Popover,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Popover>;

/** `PopoverHeader`/`PopoverTitle`/`PopoverDescription` — the shape
 * `notification-bell.tsx`'s panel uses. */
export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">Open</Button>
      </PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Notifications</PopoverTitle>
          <PopoverDescription>You&apos;re all caught up.</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Open' }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByText('Notifications')).toBeInTheDocument();
  },
};

/** `PopoverAnchor` points the popover's position at an element other than
 * its trigger — e.g. anchoring to a table row while the trigger itself
 * lives elsewhere in that row. */
export const WithAnchor: Story = {
  render: () => (
    <Popover>
      <PopoverAnchor asChild>
        <div className="flex w-64 items-center justify-between rounded-lg border border-input p-2.5 text-sm">
          <span>Row anchor</span>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm">
              Actions
            </Button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverContent>Anchored to the row, not the button.</PopoverContent>
    </Popover>
  ),
};

export const RightToLeft: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">খুলুন</Button>
      </PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>বিজ্ঞপ্তি</PopoverTitle>
          <PopoverDescription>সব দেখা হয়ে গেছে।</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  ),
  decorators: [rtlDecorator],
};
