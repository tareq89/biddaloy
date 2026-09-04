import {
  CommunicationStatus,
  EnrollmentStatus,
  FeeStatus,
  InvoiceStatus,
  PaymentStatus,
  ReminderBatchStatus,
  UserStatus,
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
      <div className="flex flex-wrap gap-2">
        <StatusBadge domain="feeStructure" status="RECURRING" />
        <StatusBadge domain="feeStructure" status="ONE_TIME" />
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.values(UserStatus).map((status) => (
          <StatusBadge key={status} domain="user" status={status} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusBadge domain="attendance" status="LOW" />
        <StatusBadge domain="attendance" status="OK" />
      </div>
    </div>
  ),
};

/** [8.11.8]'s user account status (read-only — no activate/deactivate
 * endpoint exists), shown greyscale so the label text and icon shape are
 * the only things left doing the distinguishing. */
export const UserAccountStatus: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2" style={{ filter: 'grayscale(1)' }}>
      {Object.values(UserStatus).map((status) => (
        <StatusBadge key={status} domain="user" status={status} />
      ))}
    </div>
  ),
};

/** [8.11.5]'s "recurring structures visually distinguished without relying
 * on colour" AC, shown greyscale so the label text and icon shape are the
 * only things left doing the distinguishing. */
export const FeeStructureRecurrence: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2" style={{ filter: 'grayscale(1)' }}>
      <StatusBadge domain="feeStructure" status="RECURRING" />
      <StatusBadge domain="feeStructure" status="ONE_TIME" />
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

/** [8.14.15] `globals: { locale: 'bn' }` switches every domain's labels to
 * their translated `status.<domain>.<member>` value — one badge per
 * domain, so all ~37 new Bangla strings are reviewable in one place. */
export const Bangla: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <StatusBadge domain="fee" status={FeeStatus.PARTIALLY_PAID} />
      <StatusBadge domain="payment" status={PaymentStatus.SUCCESS} />
      <StatusBadge domain="invoice" status={InvoiceStatus.ISSUED} />
      <StatusBadge domain="communication" status={CommunicationStatus.DELIVERED} />
      <StatusBadge domain="reminderBatch" status={ReminderBatchStatus.COMPLETED} />
      <StatusBadge domain="enrollment" status={EnrollmentStatus.ACTIVE} />
      <StatusBadge domain="academicYear" status="CURRENT" />
      <StatusBadge domain="guardian" status="PRIMARY" />
      <StatusBadge domain="feeStructure" status="RECURRING" />
      <StatusBadge domain="user" status={UserStatus.ACTIVE} />
      <StatusBadge domain="attendance" status="LOW" />
    </div>
  ),
  globals: { locale: 'bn' },
};
