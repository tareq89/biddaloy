import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import { userResponseFactory } from '@biddaloy/ui/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { delay, http, HttpResponse } from 'msw';
import * as React from 'react';
import { userEvent, within } from 'storybook/test';

import { ResetPasswordDialog } from './-reset-password-dialog';

const resetEndpoint = '/api/v1/users/:id/reset-password';
const meta: Meta<typeof ResetPasswordDialog> = {
  title: 'Staff/ResetPasswordDialog',
  component: ResetPasswordDialog,
  args: {
    open: true,
    isSelf: false,
    user: userResponseFactory({ id: 'story-member', full_name: 'Example Member' }),
    onOpenChange: () => {},
  },
  decorators: [
    (Story) => {
      React.useEffect(() => {
        setActiveTenant('story-school');
        setActiveRole('ADMIN');
        return () => {
          setActiveTenant(null);
          setActiveRole(null);
        };
      }, []);
      return <Story />;
    },
  ],
};
export default meta;
type Story = StoryObj<typeof ResetPasswordDialog>;
export const Confirmation: Story = {};
export const SelfDisabled: Story = { args: { isSelf: true } };
const confirm: NonNullable<Story['play']> = async () => {
  await userEvent.click(
    await within(document.body).findByRole('button', { name: 'Reset password' }),
  );
};
export const Pending: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(resetEndpoint, async () => {
          await delay('infinite');
        }),
      ],
    },
  },
  play: confirm,
};
export const Ineligible: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(resetEndpoint, () =>
          HttpResponse.json(
            { statusCode: 409, message: 'Ineligible', requestId: 'story' },
            { status: 409 },
          ),
        ),
      ],
    },
  },
  play: confirm,
};
export const Error: Story = {
  parameters: {
    msw: { handlers: [http.post(resetEndpoint, () => new HttpResponse(null, { status: 500 }))] },
  },
  play: confirm,
};
export const OneTimeCredential: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(resetEndpoint, () =>
          HttpResponse.json({
            temporary_password: 'illustrative-only-not-a-real-password',
            expires_at: '2030-01-01T12:00:00Z',
          }),
        ),
      ],
    },
  },
  play: confirm,
};
