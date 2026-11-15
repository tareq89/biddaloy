import type { Meta, StoryObj } from '@storybook/react-vite';

import { OnlinePaymentsSection } from './OnlinePaymentsSection';

/** Online payments settings card, proof half (#3977). */
const meta: Meta<typeof OnlinePaymentsSection> = {
  component: OnlinePaymentsSection,
  args: { schoolId: 'school-1' },
};
export default meta;

type Story = StoryObj<typeof OnlinePaymentsSection>;

export const Off: Story = { args: { payments: undefined } };
const MASK = { configured: true, hint: '1234' };
const SAVED_BKASH = {
  environment: 'SANDBOX',
  username: MASK,
  password: MASK,
  appKey: MASK,
  appSecret: MASK,
};

/** Nothing saved yet: all four secrets "Not added", online switch locked. */
export const BkashNotSet: Story = { args: { payments: { proofEnabled: false } } };
/** Saved but never tested: switch locked until "Test connection" passes. */
export const BkashSavedUntested: Story = {
  args: { payments: { proofEnabled: true, bkash: SAVED_BKASH } },
};
/** Test passed and online payments are on. */
export const BkashOnline: Story = {
  args: {
    payments: {
      proofEnabled: true,
      onlineEnabled: true,
      bkash: { ...SAVED_BKASH, lastTestOkAt: '2026-11-15T09:30:00.000Z' },
    },
  },
};

export const On: Story = {
  args: {
    payments: {
      proofEnabled: true,
      proofMethods: [
        { method: 'BKASH', instructions: 'Send Money to 01711-000000.' },
        { method: 'BANK_TRANSFER', instructions: 'Sample Bank, account 123456.' },
      ],
    },
  },
};
