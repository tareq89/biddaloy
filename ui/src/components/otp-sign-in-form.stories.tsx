import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { OtpSignInForm } from './otp-sign-in-form';

const meta: Meta<typeof OtpSignInForm> = {
  title: 'Components/OtpSignInForm',
  component: OtpSignInForm,
  tags: ['autodocs'],
  args: {
    onRequest: async () => {},
    onVerify: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof OtpSignInForm>;

/** Phase 1: the phone-number entry step. */
export const PhonePhase: Story = {};

/** Submitting an empty phone number triggers the required-field error, same
 * `form-field.stories.tsx`'s pattern of exercising Zod's own validation. */
export const PhoneValidationError: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Send code' }));
  },
};

/** Phase 2: the code-entry step, reached by submitting a valid phone. */
export const CodePhase: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Phone number'), '1712345678');
    await userEvent.click(canvas.getByRole('button', { name: 'Send code' }));
  },
};

/** An actual failed verify — `role="alert"`, same banner grammar as
 * `SignInForm`'s `InvalidCredentials` story. */
export const InvalidCode: Story = {
  args: {
    error: { message: 'That phone number or code is incorrect.', tone: 'alert' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Phone number'), '1712345678');
    await userEvent.click(canvas.getByRole('button', { name: 'Send code' }));
  },
};

export const Submitting: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Phone number'), '1712345678');
    await userEvent.click(canvas.getByRole('button', { name: 'Send code' }));
  },
};

export const RightToLeft: Story = {
  decorators: [rtlDecorator],
};
