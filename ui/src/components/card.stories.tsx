/**
 * No loading/empty/error variants — `Card` is a surface with no state of
 * its own; a loading card is a `Skeleton` inside one (see the
 * `WithSkeletonContent` story) rather than a `Card` variant.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Card } from './card';
import { Skeleton } from './skeleton';

const meta: Meta<typeof Card> = {
  title: 'Components/Card',
  component: Card,
  tags: ['autodocs'],
  args: {
    className: 'p-4 max-w-sm',
    children: 'Total outstanding — ৳ 11,000 across 2 of 3 children.',
  },
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {};

/** `asChild` merges the surface onto a link, so the whole card is one tap
 * target — the shape #25's per-child drill-down needs. */
export const AsLink: Story = {
  args: {
    asChild: true,
    children: (
      <a href="/portal" className="block p-4 no-underline">
        Fatima Rahman — Class 8B
      </a>
    ),
  },
};

export const WithSkeletonContent: Story = {
  args: {
    children: (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-40" />
      </div>
    ),
  },
};

/**
 * The point of [8.13.9], in one frame. A `Card` is `border-border-subtle
 * bg-card shadow-e1` (contract §4), and none of that reads as a *lift* until
 * you see it against the ground it sits on: the page is `bg-background`
 * (`#f8fafc`), the card is `bg-card` (white). Before this ticket the card
 * painted `bg-background` too, so on a white page it read as a grey panel —
 * §3.3's documented interim state, which this story exists to prove is over.
 *
 * The wrapper deliberately paints the ground itself instead of relying on the
 * Storybook canvas background, so the comparison survives a theme change to
 * the canvas.
 */
export const OnGround: Story = {
  decorators: [
    (StoryFn) => (
      <div className="bg-background p-8">
        <StoryFn />
      </div>
    ),
  ],
};

export const RightToLeft: Story = {
  decorators: [rtlDecorator],
};
