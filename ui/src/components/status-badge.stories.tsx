import {
  CommunicationStatus,
  EnrollmentStatus,
  FeeStatus,
  InvoiceStatus,
  PaymentStatus,
  ReminderBatchStatus,
} from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { StatusBadge } from './status-badge';

const meta: Meta<typeof StatusBadge> = {
  title: 'Components/StatusBadge',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof StatusBadge>;

export const Default: Story = {
  render: () => <StatusBadge domain="fee" status={FeeStatus.PAID} />,
};

/** Every status this component covers, across all `shared/src/enums`
 * domains plus `academicYear` (a plain boolean, not a `shared` enum —
 * see the component's own header comment) — the issue's own acceptance
 * criterion. */
export const AllDomains: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {Object.values(FeeStatus).map((status) => (
          <StatusBadge key={status} domain="fee" status={status} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.values(PaymentStatus).map((status) => (
          <StatusBadge key={status} domain="payment" status={status} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.values(InvoiceStatus).map((status) => (
          <StatusBadge key={status} domain="invoice" status={status} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.values(CommunicationStatus).map((status) => (
          <StatusBadge key={status} domain="communication" status={status} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.values(ReminderBatchStatus).map((status) => (
          <StatusBadge key={status} domain="reminderBatch" status={status} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.values(EnrollmentStatus).map((status) => (
          <StatusBadge key={status} domain="enrollment" status={status} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusBadge domain="academicYear" status="CURRENT" />
        <StatusBadge domain="academicYear" status="NOT_CURRENT" />
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusBadge domain="guardian" status="PRIMARY" />
        <StatusBadge domain="guardian" status="SECONDARY" />
      </div>
    </div>
  ),
};

/** The issue's own acceptance criterion: each status must be
 * distinguishable **without colour** — `grayscale(1)` proves the icon
 * shape (not the colour) is what actually carries the meaning. */
export const Greyscale: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2" style={{ filter: 'grayscale(1)' }}>
      {Object.values(FeeStatus).map((status) => (
        <StatusBadge key={status} domain="fee" status={status} />
      ))}
    </div>
  ),
};

export const RightToLeft: Story = {
  render: () => <StatusBadge domain="fee" status={FeeStatus.OVERDUE} />,
  decorators: [rtlDecorator],
};
