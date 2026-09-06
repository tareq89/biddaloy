import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { ProfileForm } from './profile-form';

const meta: Meta<typeof ProfileForm> = {
  title: 'Components/ProfileForm',
  component: ProfileForm,
  tags: ['autodocs'],
  args: {
    defaultValues: { full_name: 'Karim Rahman' },
    onSubmit: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof ProfileForm>;

export const Default: Story = {};

/** A generic error banner — `PATCH /users/me`'s 400 for anything not
 * mapped onto `full_name` itself. */
export const ServerError: Story = {
  args: {
    serverError: { message: 'Could not save your changes. Please try again.' },
  },
};

export const Submitting: Story = {
  args: { submitting: true },
};

export const RightToLeft: Story = {
  decorators: [rtlDecorator],
};

export const Bengali: Story = {
  globals: { locale: 'bn' },
};
