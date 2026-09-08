import type { Meta, StoryObj } from '@storybook/react-vite';

import { BulkSmsProjectionCard } from './bulk-sms-projection-card';

const meta: Meta<typeof BulkSmsProjectionCard> = {
  component: BulkSmsProjectionCard,
};
export default meta;

type Story = StoryObj<typeof BulkSmsProjectionCard>;

export const Off: Story = {
  args: {
    projection: { sms_recipients: 42, sms_units: 42, metering: 'OFF' },
  },
};

export const PlatformSufficient: Story = {
  args: {
    projection: {
      sms_recipients: 42,
      sms_units: 42,
      metering: 'PLATFORM',
      available: 500,
      reserved: 0,
      shortfall: 0,
    },
  },
};

export const PlatformShort: Story = {
  args: {
    projection: {
      sms_recipients: 42,
      sms_units: 42,
      metering: 'PLATFORM',
      available: 10,
      reserved: 0,
      shortfall: 32,
    },
  },
};
