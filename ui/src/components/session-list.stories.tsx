import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';
import { REGION_BD_EN } from '../i18n/region-config';

import { SessionList, type Session } from './session-list';

const NOW = Date.now();

const CURRENT_SESSION: Session = {
  id: 'session-current',
  started_at: new Date(NOW - 30 * 24 * 60 * 60_000).toISOString(),
  last_used_at: new Date(NOW - 60_000).toISOString(),
  user_agent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  ip_address: '203.0.113.5',
  current: true,
};

const OTHER_SESSION: Session = {
  id: 'session-other',
  started_at: new Date(NOW - 45 * 24 * 60 * 60_000).toISOString(),
  last_used_at: new Date(NOW - 6 * 60 * 60_000).toISOString(),
  user_agent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ip_address: '198.51.100.7',
  current: false,
};

const UNKNOWN_DEVICE_SESSION: Session = {
  id: 'session-unknown',
  started_at: new Date(NOW - 10 * 24 * 60 * 60_000).toISOString(),
  last_used_at: new Date(NOW - 2 * 24 * 60 * 60_000).toISOString(),
  user_agent: null,
  ip_address: null,
  current: false,
};

const meta: Meta<typeof SessionList> = {
  title: 'Components/SessionList',
  component: SessionList,
  tags: ['autodocs'],
  args: {
    onRevoke: fn(),
    onRevokeAll: fn(),
    config: REGION_BD_EN,
    locale: 'en',
  },
};

export default meta;
type Story = StoryObj<typeof SessionList>;

export const Populated: Story = {
  args: {
    sessions: [CURRENT_SESSION, OTHER_SESSION, UNKNOWN_DEVICE_SESSION],
  },
};

export const OnlyCurrentDevice: Story = {
  args: {
    sessions: [CURRENT_SESSION],
  },
};

export const Empty: Story = {
  args: {
    sessions: [],
  },
};

export const Loading: Story = {
  args: {
    sessions: [],
    loading: true,
  },
};

export const Error: Story = {
  args: {
    sessions: [],
    error: "Couldn't load your sessions. Please try again.",
    onRetry: fn(),
  },
};

export const RevokingOne: Story = {
  args: {
    sessions: [CURRENT_SESSION, OTHER_SESSION],
    revokingId: OTHER_SESSION.id,
  },
};

export const RTL: Story = {
  args: {
    sessions: [CURRENT_SESSION, OTHER_SESSION],
  },
  decorators: [rtlDecorator],
};
