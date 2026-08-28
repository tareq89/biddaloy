import type { Meta, StoryObj } from '@storybook/react-vite';
import { FolderPlus, SearchX } from 'lucide-react';

import { darkDecorator } from '../../.storybook/dark-decorator';
import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { EmptyState } from './empty-state';

const meta: Meta<typeof EmptyState> = {
  title: 'Components/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  args: {
    title: 'No fee structures yet',
    explanation: 'Create one to start generating monthly fees.',
    action: { label: 'Create fee structure', onClick: () => {} },
  },
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {};

/** With an icon, which is what a real route renders. The glyph sits in a
 * `bg-muted` well rather than floating bare above the heading. */
export const WithIcon: Story = {
  args: { icon: <FolderPlus aria-hidden="true" /> },
};

/**
 * The other half of [8.13.11]'s "nothing yet vs nothing matched"
 * distinction. Solid outline instead of dashed, brand-tinted well instead
 * of neutral, and an action that clears the filter rather than creating
 * anything — because the thing the user is looking for may well already
 * exist.
 */
export const NoResults: Story = {
  args: {
    kind: 'no-results',
    title: 'No students match these filters',
    explanation: 'Try a different class or academic year, or clear the filters to see everyone.',
    action: { label: 'Clear filters', onClick: () => {} },
    icon: <SearchX aria-hidden="true" />,
  },
};

/** "No results" often has two honest next moves. `secondaryAction`
 * renders the lower-emphasis one beside the primary. */
export const NoResultsWithSecondaryAction: Story = {
  args: {
    ...NoResults.args,
    secondaryAction: { label: 'Add student', onClick: () => {} },
  },
};

/** A long, translated explanation wraps inside the card rather than
 * stretching it — `max-w-prose` on the paragraph holds this. */
export const LongExplanation: Story = {
  args: {
    explanation:
      'Nothing has been recorded for this school yet. Once fee structures exist, monthly fees are generated from them for every enrolled student, and this page becomes the list of those structures.',
    icon: <FolderPlus aria-hidden="true" />,
  },
};

export const RightToLeft: Story = {
  args: {
    title: 'এখনও কোনো ফি কাঠামো নেই',
    explanation: 'মাসিক ফি তৈরি শুরু করতে একটি তৈরি করুন।',
    action: { label: 'ফি কাঠামো তৈরি করুন', onClick: () => {} },
    icon: <FolderPlus aria-hidden="true" />,
  },
  decorators: [rtlDecorator],
};

/** Rendered narrow, the way it appears inside a phone-width route body —
 * the action row wraps rather than overflowing. */
export const NarrowViewport: Story = {
  args: {
    ...NoResults.args,
    secondaryAction: { label: 'Add student', onClick: () => {} },
  },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
};

function renderKindMatrix() {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">
          kind=&quot;empty&quot; — dashed outline, neutral well, one action
        </p>
        <EmptyState
          title="No fee structures yet"
          explanation="Create one to start generating monthly fees."
          action={{ label: 'Create fee structure', onClick: () => {} }}
          icon={<FolderPlus aria-hidden="true" />}
        />
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">
          kind=&quot;no-results&quot; — solid outline, brand well, clear-the-filter action
        </p>
        <EmptyState
          kind="no-results"
          title="No students match these filters"
          explanation="Try a different class or academic year, or clear the filters to see everyone."
          action={{ label: 'Clear filters', onClick: () => {} }}
          secondaryAction={{ label: 'Add student', onClick: () => {} }}
          icon={<SearchX aria-hidden="true" />}
        />
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">no icon</p>
        <EmptyState
          title="No fee structures yet"
          explanation="Create one to start generating monthly fees."
          action={{ label: 'Create fee structure', onClick: () => {} }}
        />
      </section>
    </div>
  );
}

/** The two kinds side by side — the point being that they are
 * distinguishable with the copy blurred out. */
export const Kinds: StoryObj<typeof EmptyState> = {
  tags: ['!autodocs'],
  render: renderKindMatrix,
};

/** Same matrix, dark half of every token pair. Its own story and excluded
 * from autodocs because `darkDecorator` sets `data-theme` on `<html>` —
 * see the decorator's own doc comment. */
export const KindsDark: StoryObj<typeof EmptyState> = {
  tags: ['!autodocs'],
  decorators: [darkDecorator],
  render: renderKindMatrix,
};
