import { AuthLayout } from '@biddaloy/ui/components';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, userEvent, within } from 'storybook/test';

import { CockpitSignInCard } from './cockpit-sign-in-card';

/**
 * [98.4.03] The owner sign-in card, mockup section a. Same "client-admin isn't globbed into a
 * running Storybook yet" gap the other client-admin feature stories note.
 */
const meta: Meta<typeof CockpitSignInCard> = {
  title: 'Features/Cockpit/SignInCard',
  component: CockpitSignInCard,
  args: { onSignedIn: fn(), onEnrol: fn() },
  decorators: [
    (Story) => (
      <AuthLayout>
        <Story />
      </AuthLayout>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof CockpitSignInCard>;

export const Password: Story = {};

export const PasswordPhone: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

export const Code: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('*/auth/cockpit/login', () =>
          HttpResponse.json({ step: 'mfa', mfaToken: 'story' }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.type(await c.findByLabelText('Email or phone number'), 'owner@example.test');
    await userEvent.type(c.getByLabelText('Password'), 'secret-pass{Enter}');
    await expect(await c.findByLabelText('6-digit code from your authenticator app')).toBeTruthy();
  },
};

export const NewDevicePhone: Story = {
  ...Code,
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
    msw: {
      handlers: [
        http.post('*/auth/cockpit/login', () =>
          HttpResponse.json({ step: 'device', deviceToken: 'story' }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.type(await c.findByLabelText('Email or phone number'), 'owner@example.test');
    await userEvent.type(c.getByLabelText('Password'), 'secret-pass{Enter}');
    await expect(await c.findByLabelText('Code from the SMS')).toBeTruthy();
  },
};

export const Bangla: Story = { globals: { locale: 'bn' } };
