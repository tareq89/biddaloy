import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { OfflineState } from './offline-state';

const meta: Meta<typeof OfflineState> = {
  title: 'Components/OfflineState',
  component: OfflineState,
  tags: ['autodocs'],
  args: {
    onRetry: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof OfflineState>;

/** What a route renders when navigation failed with no connection —
 * [8.12.1]'s "designed offline page, not a browser error". */
export const Default: Story = {};

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
