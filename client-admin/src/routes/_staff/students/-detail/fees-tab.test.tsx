import { cleanupTestState, renderWithRouter, server, studentFactory } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** [16.4.5]'s Fees tab rewrite — real route tree via `/students/$studentId`
 * (same reasoning `$studentId.test.tsx` gives for its own Fees tab test),
 * since `FeesTab` is only ever mounted through that route's tab wiring. */
describe('students/-detail/fees-tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function feeLine(overrides: Record<string, unknown> = {}) {
    // Money columns are Postgres `decimal`s — the pg driver (and the real
    // API) send these as **strings**, not the `number` `schema.d.ts`
    // types them as. Fixed as strings here so a regression that goes back
    // to `+`-concatenating them (rather than `Number()`-coercing first)
    // fails this suite instead of shipping silently.
    return {
      id: 'fee-1',
      student_id: 'student-1',
      academic_year_id: 'year-1',
      fee_structure_id: 'structure-1',
      fee_structure: { id: 'structure-1', name: 'Tuition', fee_type: 'MONTHLY_TUITION' },
      fee_generation_id: null,
      period_start: '2026-03-01T00:00:00.000Z',
      period_type: 'MONTH',
      occurrence: 1,
      month: 3,
      year: 2026,
      total_amount: '500.00',
      paid_amount: '0.00',
      discount_amount: '0.00',
      standing_discount_amount: '0.00',
      one_off_discount_amount: '0.00',
      status: 'PENDING',
      due_date: null,
      reminder_threshold_date: null,
      approved_by_user_id: null,
      late_fee_for_student_fee_id: null,
      late_fee_for_student_fee: null,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      deleted_at: null,
      ...overrides,
    };
  }

  function renderFeesTab(
    feeBreakdown: Record<string, unknown>[],
    options: {
      role?: string;
      transactions?: Record<string, unknown>[];
    } = {},
  ) {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.get('/api/v1/schools/:schoolId/settings', () => HttpResponse.json({})),
      http.get('/api/v1/payments/invoices/student/:studentId', () =>
        HttpResponse.json({
          student_id: 'student-1',
          student_name: student.full_name,
          summary: { total_due: 500, total_paid: 0, total_discount: 0, balance: 500 },
          fee_breakdown: feeBreakdown,
          payments: [],
        }),
      ),
      http.get('/api/v1/students/:id/wallet', () =>
        HttpResponse.json({ balance: 150, transactions: options.transactions ?? [] }),
      ),
    );

    return renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1?tab=fees'],
      tenantId: 'tenant-1',
      role: options.role ?? 'ADMIN',
      locale: 'en',
    });
  }

  it('shows Open bills, Wallet and History section tabs', async () => {
    renderFeesTab([feeLine()]);

    await screen.findByRole('tab', { name: 'Open bills', selected: true });
    expect(screen.getByRole('tab', { name: 'Credit balance' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'History' })).toBeTruthy();
  });

  it('Open bills lists open fee lines', async () => {
    renderFeesTab([feeLine({ id: 'fee-1' }), feeLine({ id: 'fee-2', status: 'PAID' })]);

    await screen.findByRole('tab', { name: 'Open bills', selected: true });
    expect(await screen.findByText('Tuition')).toBeTruthy();
    // Only the open (PENDING) line renders here — the PAID one belongs to
    // History, not Open bills.
    expect(screen.getAllByText('Tuition')).toHaveLength(1);
  });

  it('Wallet section shows the balance via useStudentWallet', async () => {
    renderFeesTab([feeLine()]);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Credit balance' }));

    const panel = await screen.findByRole('tabpanel', { name: 'Credit balance' });
    // `renderFeesTab` overrides `/schools/:schoolId/settings` to `{}` —
    // `useTenantRegionConfig` falls back to the locale-derived default
    // (latin digits, 2 decimals), same reasoning `$studentId.test.tsx`
    // documents for its own Fees-tab assertions.
    expect(await within(panel).findByText('৳150.00')).toBeTruthy();
  });

  it('has no per-bill Record payment button for any role (the header primary is the one entry)', async () => {
    renderFeesTab([feeLine()]);

    await screen.findByRole('tab', { name: 'Open bills', selected: true });
    await screen.findByText('Tuition');
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();
  });

  it('shows the three summary amounts in one Fee summary card, with the balance flagged when owed', async () => {
    renderFeesTab([feeLine()]);

    const summary = await screen.findByLabelText('Fee summary');
    expect(within(summary).getByText('Total billed')).toBeTruthy();
    expect(within(summary).getByText('Total paid')).toBeTruthy();
    // Billed and balance are both ৳500.00 here: exactly two cells, only the balance is flagged.
    const [billed, balance] = within(summary).getAllByText('৳500.00');
    expect(within(summary).getAllByText('৳500.00')).toHaveLength(2);
    // `classList`, not a substring: a missing space would fuse two classes into one.
    expect(billed!.classList.contains('text-status-overdue-fg')).toBe(false);
    expect(balance!.classList.contains('text-status-overdue-fg')).toBe(true);
    expect(balance!.classList.contains('md:text-h2')).toBe(true);
  });

  it('shows the period as a month, a late-fee badge, and an empty state with an explanation', async () => {
    renderFeesTab([feeLine({ id: 'fee-late', late_fee_for_student_fee_id: 'fee-1' })]);

    await screen.findByText('Tuition');
    expect(screen.getByText('Late fee')).toBeTruthy();
    expect(screen.getByText(/March 2026/)).toBeTruthy();
  });

  it('shows an EmptyState when there are no open bills', async () => {
    renderFeesTab([feeLine({ status: 'PAID' })]);

    expect(await screen.findByText('Every bill for this student is paid.')).toBeTruthy();
  });

  it('Wallet transactions show a translated kind label, not the raw enum', async () => {
    renderFeesTab([feeLine()], {
      transactions: [
        {
          amount: '25.00',
          kind: 'CREDIT_OVERPAYMENT',
          note: null,
          created_at: '2026-03-02T00:00:00.000Z',
        },
      ],
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Credit balance' }));

    const panel = await screen.findByRole('tabpanel', { name: 'Credit balance' });
    expect(await within(panel).findByText('Overpayment credit')).toBeTruthy();
    expect(within(panel).queryByText('CREDIT_OVERPAYMENT')).toBeNull();
  });

  it('History shows paid bills, not open ones', async () => {
    renderFeesTab([
      feeLine({ id: 'fee-1', fee_structure: { id: 's1', name: 'Tuition' } }),
      feeLine({ id: 'fee-2', status: 'PAID', fee_structure: { id: 's2', name: 'Exam fee' } }),
    ]);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'History' }));

    const panel = await screen.findByRole('tabpanel', { name: 'History' });
    await waitFor(() => expect(within(panel).getByText('Exam fee')).toBeTruthy());
    expect(within(panel).queryByText('Tuition')).toBeNull();
  });
});
