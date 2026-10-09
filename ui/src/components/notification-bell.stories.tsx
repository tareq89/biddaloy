/**
 * [8.14.11]. `NotificationBell` reads `notification-state.ts` directly
 * (unlike `NotificationList`, its presentational half — see that
 * component's own stories), so each story seeds the real module in a
 * decorator, the same `cached-data-notice.stories.tsx` pattern for
 * module-level state. `<Link>`'s `viewAllTo` stories need a router in
 * context — see `withMemoryRouter`'s own comment.
 */
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import { withMemoryRouter } from '../../.storybook/router-decorator';
import { clearNotifications, pushNotification } from '../api/notification-state';

import { NotificationBell } from './notification-bell';

function seed(count: number): Decorator {
  const SeedDecorator: Decorator = (Story) => {
    clearNotifications();
    for (let i = 0; i < count; i += 1) {
      pushNotification({
        tenantId: null,
        variant: i % 3 === 0 ? 'error' : i % 3 === 1 ? 'info' : 'success',
        message: `Notification ${i + 1}`,
      });
    }
    return <Story />;
  };
  return SeedDecorator;
}

const meta: Meta<typeof NotificationBell> = {
  title: 'Components/NotificationBell',
  component: NotificationBell,
  tags: ['autodocs'],
  decorators: [withMemoryRouter(['/staff'])],
};

export default meta;
type Story = StoryObj<typeof NotificationBell>;

export const WithUnread: Story = {
  decorators: [seed(2)],
};

/** Two-digit count: the badge is a pill that grows towards the end edge. */
export const BadgeOverflow: Story = {
  decorators: [seed(12)],
};

/** Four digits: the store holds up to 1000 (after 31.2.11), so a full inbox
 * shows `1000` with no grouping. `9999+` needs a count the real store cannot
 * reach; the unit test pins it with a mocked count. */
export const FourDigits: Story = {
  decorators: [seed(1000)],
};

export const BadgePillAtPhoneSize: Story = {
  decorators: [seed(48)],
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

export const PanelOpen: Story = {
  decorators: [seed(3)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole('button', { name: /Notifications/ });
    await userEvent.click(trigger);
  },
};

export const WithViewAllLink: Story = {
  args: { viewAllTo: '/notifications' },
  decorators: [seed(2)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole('button', { name: /Notifications/ });
    await userEvent.click(trigger);
  },
};
