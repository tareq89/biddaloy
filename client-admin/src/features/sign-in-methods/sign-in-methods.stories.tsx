import { UserRole } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { LeaveSchoolSection } from './leave-school-section';
import { SignInMethodsCard } from './sign-in-methods-card';

const google = { provider: 'google', email: 'me@example.com', created_at: '2026-10-01T00:00:00Z' };

function handlers(providers: string[], identities: unknown[]) {
  return {
    msw: {
      handlers: [
        http.get('/api/v1/auth/social/providers', () => HttpResponse.json({ providers })),
        http.get('/api/v1/auth/social/identities', () => HttpResponse.json(identities)),
        http.get('/api/v1/schools/me/profile', () => HttpResponse.json({ name: 'Green Valley' })),
      ],
    },
  };
}

const meta: Meta<typeof SignInMethodsCard> = {
  title: 'Features/SignInMethods',
  component: SignInMethodsCard,
  args: { roles: [UserRole.ADMIN] },
};

export default meta;
type Story = StoryObj<typeof SignInMethodsCard>;

/** Google connected, Facebook available. */
export const Connected: Story = { parameters: handlers(['google', 'facebook'], [google]) };

/** Nothing connected yet. */
export const NoneConnected: Story = { parameters: handlers(['google', 'facebook'], []) };

/** No provider configured: only the Password and Code rows. */
export const NoProviders: Story = { parameters: handlers([], []) };

/** A guardian or student: the portal's password rules, same card. */
export const Guardian: Story = {
  args: { roles: [UserRole.PARENT] },
  parameters: handlers(['google'], []),
};

/** Phone-width view. */
export const Mobile: Story = {
  parameters: {
    ...handlers(['google', 'facebook'], [google]),
    viewport: { defaultViewport: 'mobile1' },
  },
};

/** The quiet leave section that ends `/security` (staff only). */
export const LeaveSchool: StoryObj<typeof LeaveSchoolSection> = {
  render: () => <LeaveSchoolSection />,
  parameters: handlers([], []),
};
