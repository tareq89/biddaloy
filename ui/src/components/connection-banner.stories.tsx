/** [3329 / 4292] Presentational view; the connected `ConnectionBanner` only feeds it. */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { ConnectionBannerView } from './connection-banner';

const meta: Meta<typeof ConnectionBannerView> = {
  title: 'Components/ConnectionBanner',
  component: ConnectionBannerView,
  tags: ['autodocs'],
  args: { online: true, slow: false, queued: 0, onRetry: fn() },
};

export default meta;
type Story = StoryObj<typeof ConnectionBannerView>;

/** Online and quick: renders nothing (no permanent banner). */
export const Hidden: Story = {};

export const Offline: Story = { args: { online: false } };

export const OfflineWithQueuedWrites: Story = { args: { online: false, queued: 3 } };

export const Slow: Story = { args: { slow: true } };
