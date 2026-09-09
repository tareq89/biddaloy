import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { PushNotificationSettings, type PushSubscriptionRow } from './push-notification-settings';

const NOW = Date.now();

const OTHER_DEVICE: PushSubscriptionRow = {
  id: 'sub-1',
  user_agent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  created_at: new Date(NOW - 30 * 24 * 60 * 60_000).toISOString(),
  last_used_at: new Date(NOW - 6 * 60 * 60_000).toISOString(),
};

const ANOTHER_DEVICE: PushSubscriptionRow = {
  id: 'sub-2',
  user_agent: null,
  created_at: new Date(NOW - 10 * 24 * 60 * 60_000).toISOString(),
  last_used_at: null,
};

const meta: Meta<typeof PushNotificationSettings> = {
  title: 'Components/PushNotificationSettings',
  component: PushNotificationSettings,
  tags: ['autodocs'],
  args: {
    onToggle: fn(),
    onRemove: fn(),
    locale: 'en',
  },
};

export default meta;
type Story = StoryObj<typeof PushNotificationSettings>;

export const UnsupportedBrowser: Story = {
  args: {
    permission: 'unsupported',
    isSubscribedOnThisDevice: false,
    subscriptions: null,
  },
};

export const PermissionDefault: Story = {
  args: {
    permission: 'default',
    isSubscribedOnThisDevice: false,
    subscriptions: [],
  },
};

export const PermissionGranted: Story = {
  args: {
    permission: 'granted',
    isSubscribedOnThisDevice: true,
    subscriptions: [],
  },
};

export const PermissionDenied: Story = {
  args: {
    permission: 'denied',
    isSubscribedOnThisDevice: false,
    subscriptions: [],
  },
};

export const MultipleDevices: Story = {
  args: {
    permission: 'granted',
    isSubscribedOnThisDevice: true,
    subscriptions: [OTHER_DEVICE, ANOTHER_DEVICE],
  },
};

export const RemovingADevice: Story = {
  args: {
    permission: 'granted',
    isSubscribedOnThisDevice: true,
    subscriptions: [OTHER_DEVICE, ANOTHER_DEVICE],
    removingId: OTHER_DEVICE.id,
  },
};

export const RTL: Story = {
  args: {
    permission: 'granted',
    isSubscribedOnThisDevice: true,
    subscriptions: [OTHER_DEVICE],
  },
  decorators: [rtlDecorator],
};
