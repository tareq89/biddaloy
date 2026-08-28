import type { Meta, StoryObj } from '@storybook/react-vite';
import { FolderPlus, SearchX, TriangleAlert, WifiOff } from 'lucide-react';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';
import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { EmptyState } from './empty-state';
import { ErrorState } from './error-state';
import { RouteStatusState } from './route-status-state';
import { SkeletonTable } from './skeleton';

const meta: Meta<typeof ErrorState> = {
  title: 'Components/ErrorState',
  component: ErrorState,
  tags: ['autodocs'],
  args: {
    message: 'Could not load students. Check your connection and try again.',
    onRetry: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof ErrorState>;

export const Default: Story = {};

/** With an icon, which is what a full-route error renders. The
 * destructive-tinted well is the same `bg-destructive/10 text-destructive`
 * pairing `Button`'s `destructive` variant uses. */
export const WithIcon: Story = {
  args: { icon: <TriangleAlert aria-hidden="true" /> },
};

export const CustomRetryLabel: Story = {
  args: { retryLabel: 'Reload page' },
};

/** Both affordances, as `RouteErrorFallback` renders them. */
export const WithHomeAffordance: Story = {
  args: { onHome: () => {}, icon: <TriangleAlert aria-hidden="true" /> },
};

export const RightToLeft: Story = {
  args: {
    message: 'শিক্ষার্থীদের তালিকা লোড করা যায়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।',
    retryLabel: 'আবার চেষ্টা করুন',
    icon: <TriangleAlert aria-hidden="true" />,
  },
  decorators: [rtlDecorator],
};

/** Rendered narrow, the way it appears inside a phone-width route body. */
export const NarrowViewport: Story = {
  args: { onHome: () => {}, icon: <TriangleAlert aria-hidden="true" /> },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
};

/**
 * [8.13.11]'s whole point in one frame: the four things a route can render
 * instead of its content, stacked so the differences are visible without
 * reading a word.
 *
 *   loading — shaped placeholder, no border, no chrome
 *   empty   — dashed outline, neutral well, flat
 *   error   — **solid** outline, destructive well, `shadow-e1`
 *   status  — dashed outline like empty, because being offline is not a
 *             fault the app committed
 *
 * Error is deliberately the only elevated, solid-bordered one. If a future
 * change makes any two of these read the same, it shows up here first.
 */
function renderStateFamily() {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">loading</p>
        <SkeletonTable rows={3} columns={4} />
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">empty — nothing yet</p>
        <EmptyState
          title="No fee structures yet"
          explanation="Create one to start generating monthly fees."
          action={{ label: 'Create fee structure', onClick: () => {} }}
          icon={<FolderPlus aria-hidden="true" />}
        />
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">empty — no results for a filter</p>
        <EmptyState
          kind="no-results"
          title="No students match these filters"
          explanation="Try a different class, or clear the filters to see everyone."
          action={{ label: 'Clear filters', onClick: () => {} }}
          icon={<SearchX aria-hidden="true" />}
        />
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">error — a fault, with a retry</p>
        <ErrorState
          message="Could not load students. Check your connection and try again."
          onRetry={() => {}}
          onHome={() => {}}
          icon={<TriangleAlert aria-hidden="true" />}
        />
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">status — offline, not a fault</p>
        <RouteStatusState
          title="You're offline"
          explanation="This page needs a connection to load. Check your network and try again."
          retryLabel="Try again"
          onRetry={() => {}}
          onHome={() => {}}
          icon={<WifiOff aria-hidden="true" />}
        />
      </section>
    </div>
  );
}

export const StateFamily: StoryObj<typeof ErrorState> = {
  tags: ['!autodocs'],
  render: renderStateFamily,
};

/** Same family on the dark half of every token pair. Its own story and
 * excluded from autodocs because `darkDecorator` sets `data-theme` on
 * `<html>` — see the decorator's own doc comment. */
export const StateFamilyDark: StoryObj<typeof ErrorState> = {
  tags: ['!autodocs'],
  decorators: [darkDecorator],
  parameters: darkDecoratorParameters,
  render: renderStateFamily,
};
