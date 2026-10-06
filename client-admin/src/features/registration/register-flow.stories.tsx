import { AuthLayout } from '@biddaloy/ui/components';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, userEvent, within } from 'storybook/test';

import { RegisterCodeStep } from './register-code-step';
import { RegisterFlow } from './register-flow';
import { RegisterPasswordStep } from './register-password-step';

/**
 * [13.5.1] The register card, three steps. Same "client-admin isn't globbed
 * into a running Storybook yet" gap the other `client-admin` feature stories
 * note — written anyway, following that precedent.
 */
const providers = http.get('/api/v1/auth/social/providers', () =>
  HttpResponse.json({ providers: ['google', 'facebook'] }),
);

const meta: Meta<typeof RegisterFlow> = {
  title: 'Features/Registration/RegisterFlow',
  component: RegisterFlow,
  args: { onDone: fn() },
  parameters: { msw: { handlers: [providers] } },
  decorators: [
    (Story) => (
      <AuthLayout>
        <Story />
      </AuthLayout>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof RegisterFlow>;

export const Details: Story = {};

export const DetailsPhone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };

export const DetailsBangla: Story = { globals: { locale: 'bn' } };

export const WithSocialTicket: Story = {
  args: {
    socialTicket: { provider: 'google' },
    initialValues: { adminName: 'Rahim Uddin', email: 'rahim@example.com' },
  },
};

export const ValidationErrors: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Continue' }));
    await expect(await canvas.findByText('Please accept to continue.')).toBeTruthy();
  },
};

/** The server answered 409 `TRIAL_ALREADY_OPEN`; the card shows its own sentence. */
export const ServerError: Story = {
  parameters: {
    msw: {
      handlers: [
        providers,
        http.post('/api/v1/auth/register/start', () =>
          HttpResponse.json(
            {
              statusCode: 409,
              message: 'x',
              requestId: 'x',
              path: '/x',
              timestamp: 't',
              details: { code: 'TRIAL_ALREADY_OPEN' },
            },
            { status: 409 },
          ),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByLabelText('Your name'), 'Rahim Uddin');
    await userEvent.type(canvas.getByLabelText('School name'), 'Green Valley School');
    await userEvent.type(canvas.getByLabelText('School address'), 'Mirpur, Dhaka');
    await userEvent.type(canvas.getByLabelText('Mobile number'), '01712345678');
    await userEvent.type(canvas.getByLabelText('Email'), 'rahim@example.com');
    await userEvent.click(canvas.getByRole('checkbox'));
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }));
  },
};

const codeArgs = {
  sentTo: '01712345678',
  channel: 'sms' as const,
  resendIn: 60,
  resendNonce: 0,
  onVerify: fn(),
  onResend: fn(),
  onChangeNumber: fn(),
};

export const CodeStep: StoryObj<typeof RegisterCodeStep> = {
  render: () => <RegisterCodeStep {...codeArgs} />,
};

export const CodeStepEmailPhone: StoryObj<typeof RegisterCodeStep> = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => <RegisterCodeStep {...codeArgs} channel="email" sentTo="rahim@example.com" />,
};

export const CodeStepInvalid: StoryObj<typeof RegisterCodeStep> = {
  render: () => <RegisterCodeStep {...codeArgs} invalid resendIn={0} />,
};

export const PasswordStep: StoryObj<typeof RegisterPasswordStep> = {
  render: () => <RegisterPasswordStep onSubmit={fn()} />,
};

export const PasswordStepSkippable: StoryObj<typeof RegisterPasswordStep> = {
  render: () => <RegisterPasswordStep onSubmit={fn()} onSkip={fn()} />,
};
