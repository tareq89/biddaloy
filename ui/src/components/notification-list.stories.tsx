/**
 * [8.14.11]. All driven by props, no module state — see `notification-
 * list.tsx`'s own header comment for why this component takes its data
 * as props rather than reading `notification-state.ts` directly.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';
import type { NotificationRecord } from '../api/notification-state';

import { NotificationList } from './notification-list';

function record(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: crypto.randomUUID(),
    tenantId: 'school-1',
    message: 'Payment recorded for Aisha Rahman',
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    read: false,
    variant: 'success',
    ...overrides,
  };
}

const meta: Meta<typeof NotificationList> = {
  title: 'Components/NotificationList',
  component: NotificationList,
  tags: ['autodocs'],
  args: {
    onMarkRead: () => undefined,
    emptyLabel: "You're all caught up.",
  },
};

export default meta;
type Story = StoryObj<typeof NotificationList>;

export const AllVariants: Story = {
  args: {
    notifications: [
      record({ variant: 'success', message: 'Payment recorded for Aisha Rahman' }),
      record({
        variant: 'error',
        message: 'Recording payment for Karim Hossain failed.',
        createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      }),
      record({
        variant: 'info',
        message: 'Reminder batch queued.',
        createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
      }),
    ],
  },
};

export const MixedReadUnread: Story = {
  args: {
    notifications: [
      record({ read: false, message: 'Unread: 12 fee records generated, 2 skipped.' }),
      record({
        read: true,
        message: 'Read: 40 of 40 students imported.',
        createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
      }),
    ],
  },
};

export const LongMessage: Story = {
  args: {
    notifications: [
      record({
        variant: 'error',
        message:
          'An offline change could not be saved because the record changed on the server since it was queued. Check the sync panel to review and resolve the conflict.',
      }),
    ],
  },
};

export const Empty: Story = {
  args: { notifications: [] },
};

export const RightToLeft: Story = {
  decorators: [rtlDecorator],
  args: {
    notifications: [
      record({ variant: 'success', message: 'Payment recorded for Aisha Rahman' }),
      record({ variant: 'error', message: 'Recording payment for Karim Hossain failed.' }),
    ],
  },
};
