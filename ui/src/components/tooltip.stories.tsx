/** `Empty`/`Loading`/`Error`/`Disabled` don't map onto a tooltip in any
 * distinct way — it either shows content on hover/focus or it doesn't,
 * there's no separate data-fetching or validation state at this layer.
 * `Default` and `RightToLeft` are the two states worth documenting. */
import type { Meta, StoryObj } from '@storybook/react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Button } from './button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

const meta: Meta<typeof Tooltip> = {
  title: 'Components/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
  decorators: [
    (StoryFn) => (
      <TooltipProvider>
        <StoryFn />
      </TooltipProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Default: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger asChild>
        <Button iconOnly aria-label="What is this?">
          ?
        </Button>
      </TooltipTrigger>
      <TooltipContent>Enrollment status for the current term</TooltipContent>
    </Tooltip>
  ),
};

export const RightToLeft: Story = {
  render: () => (
    <Tooltip defaultOpen>
      <TooltipTrigger asChild>
        <Button iconOnly aria-label="এটি কী?">
          ?
        </Button>
      </TooltipTrigger>
      <TooltipContent>চলতি মেয়াদের ভর্তির অবস্থা</TooltipContent>
    </Tooltip>
  ),
  decorators: [rtlDecorator],
};
