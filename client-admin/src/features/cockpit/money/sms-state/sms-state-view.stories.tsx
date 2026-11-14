import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { smsReportFixture } from '../../../../../../ui/src/test/msw/handlers/platform-money';

import { SmsStateView } from './sms-state-view';

/** #3883 SMS state. Phone (390 px) is one column of cards; desktop (1440 px) is a table. */
const meta = {
  title: 'Cockpit/Money/SmsStateView',
  component: SmsStateView,
  args: {
    report: smsReportFixture,
    loading: false,
    onRetry: fn(),
    onAction: fn(),
    onOpenSchool: fn(),
    onCsv: fn(),
  },
} satisfies Meta<typeof SmsStateView>;
export default meta;
type Story = StoryObj<typeof meta>;

const phone = { viewport: { defaultViewport: 'mobile1' } };

/** Red, amber and amber and red lines, stale company number. */
export const Populated: Story = {};
export const Phone390: Story = { parameters: phone, args: { layout: 'cards' } };
export const Desktop1440: Story = {
  parameters: { viewport: { defaultViewport: 'desktop' } },
  args: { layout: 'table' },
};
export const Neutral: Story = {
  args: {
    report: {
      ...smsReportFixture,
      actionLines: [
        {
          code: 'SMS_EXPIRING',
          tone: 'neutral',
          params: { sms: 300, days: 20 },
          target: { kind: 'tab', tab: 'report' },
        },
      ],
      balance: { sms: 40000, kind: 'AUTO', enteredAt: null, stale: false },
    },
  },
};
export const Loading: Story = { args: { report: undefined, loading: true } };
export const Empty: Story = {
  args: {
    report: {
      ...smsReportFixture,
      actionLines: [],
      schools: [],
      packages: [],
      totals: { ...smsReportFixture.totals, soldSms: 0 },
    },
  },
};
export const ErrorState: Story = { args: { error: 'Could not load the SMS numbers. Try again.' } };
