import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeesSection } from './FeesSection';

const SCHOOL_ID = 'school-1';

const FEES = {
  approvalMode: 'OTP' as const,
  notifyOnManualGenerationDefault: false,
  notifyOnScheduleDefault: true,
  late_fees: {
    MONTHLY_TUITION: { enabled: true, grace_days: 5, kind: 'PERCENT' as const, value: 2 },
  },
};

// No jest-dom — same `.value`/`aria-checked` reading `AttendanceSection.test.tsx` uses.
function inputValue(element: HTMLElement): string {
  return (element as HTMLInputElement | HTMLSelectElement).value;
}

function isChecked(element: HTMLElement): boolean {
  return element.getAttribute('aria-checked') === 'true';
}

describe('FeesSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the current approval mode, notify defaults and late-fee config', async () => {
    renderWithProviders(<FeesSection schoolId={SCHOOL_ID} fees={FEES} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    expect((await screen.findByLabelText('Approval method')).textContent).toBe('OTP only');
    expect(isChecked(screen.getByLabelText('Notify by default for scheduled fee generation'))).toBe(
      true,
    );
    expect(isChecked(screen.getByLabelText('Notify by default for manual fee generation'))).toBe(
      false,
    );
    expect(isChecked(screen.getByLabelText('Monthly tuition'))).toBe(true);
    expect(screen.queryByText('MONTHLY_TUITION')).toBeNull();
    expect(inputValue(screen.getByLabelText('Monthly tuition: Grace days'))).toBe('5');
  });

  it('sends only the fees slice, with grace days and value coerced to numbers', async () => {
    const patchBody = vi.fn();
    server.use(
      http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
        patchBody(await request.json());
        return HttpResponse.json({ version: 1 });
      }),
    );

    const { user } = renderWithProviders(<FeesSection schoolId={SCHOOL_ID} fees={FEES} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    await user.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    const body = patchBody.mock.calls[0]![0];
    expect(Object.keys(body)).toEqual(['version', 'fees']);
    expect(body.fees.late_fees.MONTHLY_TUITION).toEqual({
      enabled: true,
      grace_days: 5,
      kind: 'PERCENT',
      value: 2,
    });
  });

  it('adding a late-fee config that gets a 403 APPROVAL_REQUIRED surfaces as a save error, not silently dropped', async () => {
    server.use(
      http.patch('/api/v1/schools/:id/settings', () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'Approval required',
            details: { code: 'APPROVAL_REQUIRED', scope: 'fees.discount' },
          },
          { status: 403 },
        ),
      ),
    );

    const { user } = renderWithProviders(<FeesSection schoolId={SCHOOL_ID} fees={FEES} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    await user.click(await screen.findByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't save. Try again.");
    expect(screen.queryByText('Approval required')).toBeNull();
  });

  it('shows late-fee inputs only for ticked fee types', async () => {
    const { user, container } = renderWithProviders(
      <FeesSection schoolId={SCHOOL_ID} fees={FEES} />,
      { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID },
    );

    await screen.findByLabelText('Monthly tuition');
    expect(container.querySelector('#fees-lateFee-EXAM_FEE-graceDays')).toBeNull();
    await user.click(screen.getByLabelText('Exam fee'));
    expect(screen.getByLabelText('Exam fee: Grace days')).toBeTruthy();
  });

  it('on a phone shows visible-labelled late-fee fields only for a ticked fee', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      const { user } = renderWithProviders(<FeesSection schoolId={SCHOOL_ID} fees={FEES} />, {
        locale: 'en',
        role: 'ADMIN',
        tenantId: SCHOOL_ID,
      });

      await screen.findByLabelText('Monthly tuition');
      expect(screen.queryByRole('table')).toBeNull();
      // Ticked row: the three fields carry their own visible labels.
      expect(screen.getByLabelText('Grace days')).toBeTruthy();
      expect(screen.getByLabelText('Kind')).toBeTruthy();
      expect(screen.getByLabelText('Value')).toBeTruthy();
      await user.click(screen.getByLabelText('Exam fee'));
      expect(screen.getAllByLabelText('Grace days')).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
