import {
  CommunicationStatus,
  EnrollmentStatus,
  FeeStatus,
  InvoiceStatus,
  PaymentStatus,
  ReminderBatchStatus,
  UserStatus,
} from '@biddaloy/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it('renders a humanized label for a fee status', () => {
    render(<StatusBadge domain="fee" status={FeeStatus.PARTIALLY_PAID} />);
    expect(screen.getByText('Partially paid')).toBeTruthy();
  });

  it('is axe clean', async () => {
    const { container } = render(<StatusBadge domain="payment" status={PaymentStatus.SUCCESS} />);
    await expect(container).toHaveNoViolations();
  });

  it.each([
    [FeeStatus.PENDING, 'warning'],
    [FeeStatus.PARTIALLY_PAID, 'info'],
    [FeeStatus.PAID, 'success'],
    [FeeStatus.OVERDUE, 'danger'],
    [FeeStatus.WAIVED, 'neutral'],
    [FeeStatus.ADVANCE, 'info'],
  ])('maps FeeStatus.%s to the %s tone', (status, tone) => {
    render(<StatusBadge domain="fee" status={status} />);
    expect(screen.getByText(/./).getAttribute('data-tone')).toBe(tone);
  });

  it.each(Object.values(FeeStatus))(
    'renders every FeeStatus value without throwing: %s',
    (status) => {
      expect(() => render(<StatusBadge domain="fee" status={status} />)).not.toThrow();
    },
  );

  it.each(Object.values(PaymentStatus))(
    'renders every PaymentStatus value without throwing: %s',
    (status) => {
      expect(() => render(<StatusBadge domain="payment" status={status} />)).not.toThrow();
    },
  );

  it.each(Object.values(InvoiceStatus))(
    'renders every InvoiceStatus value without throwing: %s',
    (status) => {
      expect(() => render(<StatusBadge domain="invoice" status={status} />)).not.toThrow();
    },
  );

  it.each(Object.values(CommunicationStatus))(
    'renders every CommunicationStatus value without throwing: %s',
    (status) => {
      expect(() => render(<StatusBadge domain="communication" status={status} />)).not.toThrow();
    },
  );

  it.each(Object.values(ReminderBatchStatus))(
    'renders every ReminderBatchStatus value without throwing: %s',
    (status) => {
      expect(() => render(<StatusBadge domain="reminderBatch" status={status} />)).not.toThrow();
    },
  );

  it.each(Object.values(EnrollmentStatus))(
    'renders every EnrollmentStatus value without throwing: %s',
    (status) => {
      expect(() => render(<StatusBadge domain="enrollment" status={status} />)).not.toThrow();
    },
  );

  it.each([
    ['CURRENT', 'success'],
    ['NOT_CURRENT', 'neutral'],
  ] as const)('maps academicYear %s to the %s tone', (status, tone) => {
    render(<StatusBadge domain="academicYear" status={status} />);
    expect(screen.getByText(/./).getAttribute('data-tone')).toBe(tone);
  });

  it('renders a humanized label for the academicYear domain', () => {
    render(<StatusBadge domain="academicYear" status="NOT_CURRENT" />);
    expect(screen.getByText('Not current')).toBeTruthy();
  });

  it.each([
    ['PRIMARY', 'success'],
    ['SECONDARY', 'neutral'],
  ] as const)('[8.11.4] maps guardian %s to the %s tone', (status, tone) => {
    render(<StatusBadge domain="guardian" status={status} />);
    expect(screen.getByText(/./).getAttribute('data-tone')).toBe(tone);
  });

  it('[8.11.4] renders a humanized label for the guardian domain', () => {
    render(<StatusBadge domain="guardian" status="SECONDARY" />);
    expect(screen.getByText('Secondary')).toBeTruthy();
  });

  it.each([
    ['RECURRING', 'info'],
    ['ONE_TIME', 'neutral'],
  ] as const)('[8.11.5] maps feeStructure %s to the %s tone', (status, tone) => {
    render(<StatusBadge domain="feeStructure" status={status} />);
    expect(screen.getByText(/./).getAttribute('data-tone')).toBe(tone);
  });

  // The AC is "recurring structures visually distinguished without relying
  // on colour" — the label text is what satisfies it, so assert the text.
  it('[8.11.5] renders a humanized label for the feeStructure domain', () => {
    render(<StatusBadge domain="feeStructure" status="ONE_TIME" />);
    expect(screen.getByText('One time')).toBeTruthy();
  });

  it.each([
    ['ACTIVE', 'success'],
    ['INACTIVE', 'neutral'],
    ['SUSPENDED', 'warning'],
  ] as const)('[8.11.8] maps user %s to the %s tone', (status, tone) => {
    render(<StatusBadge domain="user" status={UserStatus[status]} />);
    expect(screen.getByText(/./).getAttribute('data-tone')).toBe(tone);
  });

  // The AC is "status conveyed by text, not colour alone" — assert the
  // humanized label text is what actually renders.
  it('[8.11.8] renders a humanized label for the user domain', () => {
    render(<StatusBadge domain="user" status={UserStatus.SUSPENDED} />);
    expect(screen.getByText('Suspended')).toBeTruthy();
  });

  it('every tone within one domain maps to a visually distinct icon (the greyscale guarantee)', () => {
    const { container } = render(
      <>
        <StatusBadge domain="fee" status={FeeStatus.PAID} />
        <StatusBadge domain="fee" status={FeeStatus.PARTIALLY_PAID} />
        <StatusBadge domain="fee" status={FeeStatus.PENDING} />
        <StatusBadge domain="fee" status={FeeStatus.OVERDUE} />
        <StatusBadge domain="fee" status={FeeStatus.WAIVED} />
      </>,
    );
    const iconClassNames = Array.from(container.querySelectorAll('svg')).map((svg) =>
      svg.getAttribute('class'),
    );
    expect(new Set(iconClassNames).size).toBe(iconClassNames.length);
  });
});
