import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import { REGION_BD_EN } from '../i18n/region-config';

import { GuardianContactForm } from './guardian-contact-form';

const meta: Meta<typeof GuardianContactForm> = {
  title: 'Components/GuardianContactForm',
  component: GuardianContactForm,
  tags: ['autodocs'],
  args: {
    config: REGION_BD_EN,
    onSubmit: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof GuardianContactForm>;

export const Default: Story = {
  args: {
    defaultValues: {
      phone: '1712345678',
      alternate_phone: '',
      email: 'karim@example.com',
      preferred_communication: 'SMS',
      notifications_enabled: true,
    },
  },
};

/** A guardian record with no numbers on file yet — every field starts
 * blank, not a placeholder value that reads as real data. */
export const Empty: Story = {
  args: {
    defaultValues: {
      phone: '',
      alternate_phone: '',
      email: '',
      preferred_communication: 'SMS',
      notifications_enabled: true,
    },
  },
};

/** [8.14.4] plan correction 2 — the BD-only phone regex rejection made
 * visible, not just enforced silently. */
export const InvalidPhone: Story = {
  args: {
    defaultValues: {
      phone: '5551234',
      alternate_phone: '',
      email: 'karim@example.com',
      preferred_communication: 'SMS',
      notifications_enabled: true,
    },
  },
  // Blurs the field so the BD-regex rejection actually renders — a static
  // invalid default value shows no error until the field has been touched
  // (`mode: 'onBlur'`).
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const phone = canvas.getByLabelText('Phone');
    await userEvent.click(phone);
    await userEvent.tab();
  },
};

export const NotificationsDisabled: Story = {
  args: {
    defaultValues: {
      phone: '1712345678',
      alternate_phone: '',
      email: 'karim@example.com',
      preferred_communication: 'SMS',
      notifications_enabled: false,
    },
  },
};

export const Bengali: Story = {
  args: {
    defaultValues: {
      phone: '1712345678',
      alternate_phone: '',
      email: 'karim@example.com',
      preferred_communication: 'SMS',
      notifications_enabled: true,
    },
  },
  globals: { locale: 'bn' },
};
