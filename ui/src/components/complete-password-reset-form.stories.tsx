import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { userEvent, within } from 'storybook/test';

import { useTranslation } from '../i18n';

import { CompletePasswordResetForm } from './complete-password-reset-form';
import { SignInForm } from './sign-in-form';

const meta: Meta<typeof CompletePasswordResetForm> = {
  title: 'Components/CompletePasswordResetForm',
  component: CompletePasswordResetForm,
  tags: ['autodocs'],
  args: { onSubmit: () => {}, onCancel: () => {} },
};
export default meta;
type Story = StoryObj<typeof CompletePasswordResetForm>;
export const Default: Story = {};
export const Submitting: Story = { args: { submitting: true } };
export const InvalidOrExpired: Story = {
  args: { serverError: { message: 'This reset is invalid or expired. Return to sign in again.' } },
};
export const Mismatch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('New password'), 'test-password');
    await userEvent.type(canvas.getByLabelText('Confirm new password'), 'different-password');
    await userEvent.click(canvas.getByRole('button', { name: 'Save new password' }));
  },
};
function CompletionPreview() {
  const { t } = useTranslation('auth');
  const [complete, setComplete] = React.useState(false);
  return complete ? (
    <>
      <p role="status">{t('reset.success')}</p>
      <SignInForm onSubmit={() => {}} />
    </>
  ) : (
    <CompletePasswordResetForm onSubmit={() => setComplete(true)} onCancel={() => {}} />
  );
}
export const CompletionSuccess: Story = {
  render: () => <CompletionPreview />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('New password'), 'test-password');
    await userEvent.type(canvas.getByLabelText('Confirm new password'), 'test-password');
    await userEvent.click(canvas.getByRole('button', { name: 'Save new password' }));
  },
};
export const Bengali: Story = { globals: { locale: 'bn' } };
