import type { Meta, StoryObj } from '@storybook/react-vite';
import { RefreshCw, WifiOff } from 'lucide-react';

import { darkDecorator } from '../../.storybook/dark-decorator';
import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { RouteStatusState } from './route-status-state';

const meta: Meta<typeof RouteStatusState> = {
  title: 'Components/RouteStatusState',
  component: RouteStatusState,
  tags: ['autodocs'],
  // The component has no default copy — it serves two situations that say
  // different things, so `RouteErrorFallback` owns both sets of strings.
  // These are the offline caller's; `UpdateAvailable` below overrides them.
  args: {
    title: "You're offline",
    explanation:
      'This page needs a connection to load. Check your network and try again — anything already loaded is still available.',
    retryLabel: 'Try again',
    icon: <WifiOff aria-hidden="true" />,
    onRetry: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof RouteStatusState>;

/** What a route renders when navigation failed with no connection —
 * [8.12.1]'s "designed offline page, not a browser error". */
export const Default: Story = {};

/** [8.12.2]'s other caller: a tab running code whose lazy chunks a deploy
 * has already deleted. Same polite treatment as offline — a routine
 * deploy is no more the user's fault than a tunnel is. */
export const UpdateAvailable: Story = {
  args: {
    title: 'A newer version is available',
    explanation:
      'This page is from an older version of the app. Reload to pick up the new one — anything you have already saved is safe.',
    retryLabel: 'Reload to update',
    icon: <RefreshCw aria-hidden="true" />,
    onHome: () => {},
  },
};

/** As rendered by `RouteErrorFallback`, which supplies both affordances. */
export const WithHomeAffordance: Story = {
  args: { onHome: () => {} },
};

/** Bengali copy under RTL layout — the labels are caller-supplied strings,
 * so a translated route passes them straight through. */
export const RightToLeft: Story = {
  args: {
    title: 'আপনি অফলাইনে আছেন',
    explanation:
      'এই পৃষ্ঠাটি লোড করতে সংযোগ প্রয়োজন। আপনার নেটওয়ার্ক পরীক্ষা করে আবার চেষ্টা করুন।',
    retryLabel: 'আবার চেষ্টা করুন',
    homeLabel: 'হোমে যান',
    onHome: () => {},
  },
  decorators: [rtlDecorator],
};

/** A long, translated explanation must wrap inside the card rather than
 * stretching it — `max-w-prose` on the paragraph is what holds this. */
export const LongExplanation: Story = {
  args: {
    explanation:
      'This page has not been opened on this device before, so there is no saved copy to fall back on. Reconnect to load it. Pages you have already visited stay available offline, and anything you change while disconnected is kept until the connection returns.',
    onHome: () => {},
  },
};

/** Rendered narrow, the way it appears inside a phone-width route body. */
export const NarrowViewport: Story = {
  args: { onHome: () => {} },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
};

function renderStatusForks() {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">offline fork ([8.12.1])</p>
        <RouteStatusState
          title="You're offline"
          explanation="This page needs a connection to load. Check your network and try again — anything already loaded is still available."
          retryLabel="Try again"
          onRetry={() => {}}
          onHome={() => {}}
          icon={<WifiOff aria-hidden="true" />}
        />
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">update fork ([8.12.2])</p>
        <RouteStatusState
          title="A newer version is available"
          explanation="This page is from an older version of the app. Reload to pick up the new one — anything you have already saved is safe."
          retryLabel="Reload to update"
          onRetry={() => {}}
          onHome={() => {}}
          icon={<RefreshCw aria-hidden="true" />}
        />
      </section>
    </div>
  );
}

/** Both forks `RouteErrorFallback` routes here, side by side. They share
 * `EmptyState`'s dashed, flat card on purpose — neither is a fault, so
 * neither wears `ErrorState`'s solid, elevated one ([8.13.11]). */
export const StatusForks: StoryObj<typeof RouteStatusState> = {
  tags: ['!autodocs'],
  render: renderStatusForks,
};

/** Same pair on the dark half of every token pair. Its own story and
 * excluded from autodocs because `darkDecorator` sets `data-theme` on
 * `<html>` — see the decorator's own doc comment. */
export const StatusForksDark: StoryObj<typeof RouteStatusState> = {
  tags: ['!autodocs'],
  decorators: [darkDecorator],
  render: renderStatusForks,
};
