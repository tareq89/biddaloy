import type { Meta, StoryObj } from '@storybook/react';
import { userEvent, within } from '@storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { SignInForm } from './sign-in-form';

const meta: Meta<typeof SignInForm> = {
  title: 'Components/SignInForm',
  component: SignInForm,
  tags: ['autodocs'],
  args: {
    onSubmit: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof SignInForm>;

export const Default: Story = {};

/** Submitting empty triggers both fields' required-field errors — the same
 * `form-field.stories.tsx`'s `ErrorState` pattern of exercising Zod's own
 * validation rather than scripting the error text by hand. */
export const ValidationError: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Sign in' }));
  },
};

/** The approved `templates/sign-in` mockup's "rate limited" cell — a form-
 * level banner, `role="status"` (calm, not alarming, per the issue's own
 * AC), with the wait pulled from the server's `Retry-After` header by
 * `client-admin/src/routes/login.tsx`. */
export const RateLimited: Story = {
  args: {
    error: { message: 'Too many attempts. Try again in 45 seconds.', tone: 'status' },
  },
};

/** An actual failed login — `role="alert"`, since unlike rate limiting this
 * is a genuine failure the AC wants announced assertively. */
export const InvalidCredentials: Story = {
  args: {
    error: { message: 'That email/phone or password is incorrect.', tone: 'alert' },
  },
};

export const Submitting: Story = {
  args: { loading: true },
};

export const RightToLeft: Story = {
  decorators: [rtlDecorator],
};
