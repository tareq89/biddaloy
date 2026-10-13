import { UserRole } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { userEvent, within } from 'storybook/test';

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

/** Opens "Connect Google" → password dialog, types a password and (unless 200) submits. */
function connectDialog(status: number, details?: Record<string, string>): Story {
  return {
    parameters: {
      msw: {
        handlers: [
          ...handlers(['google'], []).msw.handlers,
          http.post('/api/v1/auth/social/google/link-start', () =>
            status === 200
              ? HttpResponse.json({ url: '#' })
              : HttpResponse.json({ statusCode: status, message: 'x', details }, { status }),
          ),
        ],
      },
    },
    play: async ({ canvasElement }) => {
      await userEvent.click(
        await within(canvasElement).findByRole('button', { name: 'Connect Google' }),
      );
      const body = within(document.body);
      await userEvent.type(await body.findByLabelText('Current password'), 'hunter2');
      if (status !== 200) await userEvent.click(body.getByRole('button', { name: 'Continue' }));
    },
  };
}

/** The password dialog, just opened. */
export const ConnectPasswordDialog: Story = connectDialog(200);

/** The server said the password is wrong. */
export const ConnectWrongPassword: Story = connectDialog(403);

/** The account has no password yet. */
export const ConnectNoPassword: Story = connectDialog(400, { code: 'NO_PASSWORD' });

/** The quiet leave section that ends `/security` (staff only). */
export const LeaveSchool: StoryObj<typeof LeaveSchoolSection> = {
  render: () => <LeaveSchoolSection />,
  parameters: handlers([], []),
};
