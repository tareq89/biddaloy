import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Label } from './label';

const meta: Meta<typeof Label> = {
  title: 'Components/Label',
  component: Label,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Label>;

export const Default: Story = {
  args: { children: 'School name' },
};

/** Reach for `Label` directly outside a `FormField` — e.g. labelling a
 * standalone control via `htmlFor`, the way `FormField`'s own `FormLabel`
 * does for you internally. */
export const WithControl: Story = {
  render: () => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="story-school-name">School name</Label>
      <input
        id="story-school-name"
        className="rounded-lg border border-input bg-card px-2.5 py-2 text-sm"
      />
    </div>
  ),
};

export const RightToLeft: Story = {
  args: { children: 'স্কুলের নাম' },
  decorators: [rtlDecorator],
};
