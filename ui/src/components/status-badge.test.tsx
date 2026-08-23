import {
  CommunicationStatus,
  EnrollmentStatus,
  FeeStatus,
  InvoiceStatus,
  PaymentStatus,
  ReminderBatchStatus,
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
