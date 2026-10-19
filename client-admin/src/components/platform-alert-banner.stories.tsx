import type { Meta, StoryObj } from '@storybook/react-vite';

import { PlatformAlertNotice, ReadOnlyNotice } from './platform-alert-banner';

const meta: Meta<typeof PlatformAlertNotice> = {
  component: PlatformAlertNotice,
  args: { alert: { kind: 'REDIS_DOWN', opened_at: '2026-10-13T08:02:00.000Z' } },
};
export default meta;
type Story = StoryObj<typeof PlatformAlertNotice>;

/** An open alert on desktop. */
export const Open: Story = {};

/** One truncated line at 390 px. */
export const OpenPhone: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

/** Seat grace: the school is read-only until the date, then pauses. */
export const ReadOnlyGrace: StoryObj<typeof ReadOnlyNotice> = {
  render: () => <ReadOnlyNotice until="2026-12-07T18:00:00.000Z" />,
};
