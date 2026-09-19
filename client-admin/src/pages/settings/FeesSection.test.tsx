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

    expect(inputValue(await screen.findByLabelText('Approval method'))).toBe('OTP');
    expect(isChecked(screen.getByLabelText('Notify by default for scheduled fee generation'))).toBe(
      true,
    );
    expect(isChecked(screen.getByLabelText('Notify by default for manual fee generation'))).toBe(
      false,
    );
    expect(isChecked(screen.getByLabelText('MONTHLY_TUITION'))).toBe(true);
    expect(
      inputValue(
        screen.getByLabelText('Grace days', {
          selector: '#fees-lateFee-MONTHLY_TUITION-graceDays',
        }),
      ),
    ).toBe('5');
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

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
