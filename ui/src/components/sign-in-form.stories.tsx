import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

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

/** `client-admin/src/routes/login.tsx`'s real usage — a "Forgot password?"
 * link rendered under the submit button. `ui/` can't know the route tree
 * (same reasoning as `UserMenu.profileItem`), so the story stands in with
 * a plain anchor. */
export const WithSecondaryAction: Story = {
  args: {
    secondaryAction: (
      <a href="#forgot-password" className="text-primary underline">
        Forgot password?
      </a>
    ),
  },
};

/**
 * [8.13.8] The form under comfortable density (`/login` is comfortable in
 * the real app — see `client-admin/src/routes/login.tsx`).
 *
 * The thing to look at is the show/hide password toggle. Every other control
 * here simply takes `--control-h` and becomes 44px; this one is inset inside
 * the 44px field, so it derives its height instead (44 - 4 = 40px) and gives
 * the 4px back as an invisible `::after` hit area. If it ever renders flush
 * with the field's top and bottom edges, or its hover background covers the
 * input's rounded end corner, the derivation has been lost.
 *
 * A wrapper element carries the attribute here rather than `useDensity`
 * mutating `document.documentElement`: this file is `autodocs`, and a
 * document-level mutation cannot be scoped to one story's subtree (see
 * `.storybook/dark-decorator.tsx`'s warning). Nothing in this form is
 * portalled, so a wrapper is faithful for these controls specifically.
 */
export const ComfortableDensity: Story = {
  decorators: [
    (Story) => (
      <div data-density="comfortable">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Show' }));
  },
};
