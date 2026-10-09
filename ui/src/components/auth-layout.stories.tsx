import { UserRole } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';

import { AuthLayout } from './auth-layout';
import { SchoolPicker } from './school-picker';
import { SetPasswordForm } from './set-password-form';
import { SignInForm } from './sign-in-form';

const meta: Meta<typeof AuthLayout> = {
  title: 'Components/AuthLayout',
  component: AuthLayout,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof AuthLayout>;

const signIn = (
  <AuthLayout>
    <SignInForm onSubmit={() => {}} />
  </AuthLayout>
);
const setPassword = (
  <AuthLayout>
    <SetPasswordForm heading="Welcome, Rahima" onSubmit={() => {}} />
  </AuthLayout>
);
const picker = (
  <AuthLayout>
    <SchoolPicker
      schools={[
        { tenantId: 't1', name: 'Greenview School', role: UserRole.ADMIN },
        { tenantId: 't2', name: 'Rose Valley School', role: UserRole.TEACHER },
      ]}
      onSelect={() => {}}
    />
  </AuthLayout>
);
const mobile = { viewport: { defaultViewport: 'mobile1' } };

export const SignIn: Story = { render: () => signIn };
export const SignInMobile: Story = { render: () => signIn, parameters: mobile };
export const SetPassword: Story = { render: () => setPassword };
export const SetPasswordMobile: Story = { render: () => setPassword, parameters: mobile };
export const SchoolPickerStory: Story = { name: 'SchoolPicker', render: () => picker };
export const SchoolPickerMobile: Story = { render: () => picker, parameters: mobile };

export const Dark: Story = {
  render: () => signIn,
  decorators: [darkDecorator],
  parameters: { ...darkDecoratorParameters },
};
