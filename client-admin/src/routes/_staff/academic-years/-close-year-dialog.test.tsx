import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloseYearDialog } from './-close-year-dialog';

afterEach(async () => {
  await cleanupTestState();
});

const PREVIEW = {
  blocks: [],
  warnings: [
    { code: 'CLASSES_NOT_PROMOTED', count: 2 },
    { code: 'DUES_OUTSTANDING', count: 150000 },
    { code: 'GROUPS_PENDING', count: 0 },
  ],
  freezes: [
    { table: 'exams', count: 12 },
    { table: 'student_fees', count: 340 },
    { table: 'enrollments', count: 0 },
  ],
};

function open(onClosed = vi.fn(), onOpenChange = vi.fn()) {
  renderWithRouter(
    createRootRoute({
      component: () => (
        <CloseYearDialog
          open
          onOpenChange={onOpenChange}
          academicYearId="year-1"
          academicYearName="2026"
          onClosed={onClosed}
        />
      ),
    }),
    { initialEntries: ['/'], tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' },
  );
  return { onClosed, onOpenChange };
}

describe('CloseYearDialog', () => {
  it('lists what will no longer change and what to check, skipping zero counts', async () => {
    server.use(
      http.get('/api/v1/academic-years/:id/close-preview', () => HttpResponse.json(PREVIEW)),
      // The shared mock school has decimals 0; a real BD school has 2 (paisa).
      http.get('/api/v1/schools/:id/settings', () =>
        HttpResponse.json({
          version: 1,
          region: {
            currency: {
              code: 'BDT',
              symbol: '৳',
              position: 'prefix',
              decimals: 2,
              grouping: 'lakh-crore',
            },
            numerals: 'latin',
          },
        }),
      ),
    );
    open();
    expect(await screen.findByText('Exams: 12')).toBeTruthy();
    expect(screen.getByText('Bills: 340')).toBeTruthy();
    expect(screen.queryByText(/Enrolments/)).toBeNull();
    expect(screen.getByText('Classes not promoted: 2')).toBeTruthy();
    // 150000 paisa is 1,500.00 taka, not 150,000.
    expect(await screen.findByText('Dues outstanding: ৳1,500.00')).toBeTruthy();
    expect(screen.queryByText(/Groups pending/)).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Close year' }).disabled).toBe(
      false,
    );
  });

  it('an open promotion draft blocks the close and turns the primary button off', async () => {
    server.use(
      http.get('/api/v1/academic-years/:id/close-preview', () =>
        HttpResponse.json({
          ...PREVIEW,
          blocks: [{ code: 'DRAFT_PROMOTION_RUN_OPEN', count: 1 }],
        }),
      ),
    );
    open();
    expect(await screen.findByText(/promotion draft is still open/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open promotions' })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Close year' }).disabled).toBe(
      true,
    );
  });

  it('APPROVAL_REQUIRED opens the approval modal, then the retry closes the year', async () => {
    let attempt = 0;
    server.use(
      http.get('/api/v1/academic-years/:id/close-preview', () => HttpResponse.json(PREVIEW)),
      http.post('/api/v1/academic-years/:id/close', () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            {
              ...apiErrorBody(403, 'Approval required', '/academic-years/year-1/close'),
              details: { code: 'APPROVAL_REQUIRED' },
            },
            { status: 403 },
          );
        }
        return HttpResponse.json({ id: 'year-1', closed_at: '2026-12-31T00:00:00Z' });
      }),
      http.post('/api/v1/auth/step-up/otp/request', () => HttpResponse.json({}, { status: 202 })),
      http.post('/api/v1/auth/step-up', () =>
        HttpResponse.json(
          { approval_token: 'tok-1', approver: { id: 'u1', name: 'Admin' } },
          { status: 201 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { onClosed } = open();

    await user.click(await screen.findByRole('button', { name: 'Close year' }));
    await user.type(await screen.findByLabelText('Email or phone'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('Verification code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(onClosed).toHaveBeenCalled());
    expect(attempt).toBe(2);
  });

  it('a failed close says so and leaves the dialog open', async () => {
    server.use(
      http.get('/api/v1/academic-years/:id/close-preview', () => HttpResponse.json(PREVIEW)),
      http.post('/api/v1/academic-years/:id/close', () =>
        HttpResponse.json(apiErrorBody(409, 'x', '/academic-years/year-1/close'), { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    const { onClosed } = open();
    await user.click(await screen.findByRole('button', { name: 'Close year' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not close the year');
    expect(onClosed).not.toHaveBeenCalled();
  });
});
