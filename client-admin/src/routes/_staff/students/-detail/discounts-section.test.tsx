import {
  apiErrorBody,
  cleanupTestState,
  renderWithProviders,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

import { DiscountsSection } from './discounts-section';

/** [16.7.6]'s Discounts section — mounted through the real route tree via
 * `/students/$studentId` and the Fees tab's "Discounts" tab, same
 * reasoning `fees-tab.test.tsx` gives for its own suite. */
describe('students/-detail/discounts-section', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function discountRule(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rule-1',
      student_id: 'student-1',
      kind: 'PERCENT',
      value: 10,
      fee_types: null,
      starts_on: null,
      ends_on: null,
      reason: 'Sibling discount',
      ...overrides,
    };
  }

  function renderDiscountsTab(rules: Record<string, unknown>[], options: { role?: string } = {}) {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.get('/api/v1/schools/:schoolId/settings', () => HttpResponse.json({})),
      http.get('/api/v1/payments/invoices/student/:studentId', () =>
        HttpResponse.json({
          student_id: 'student-1',
          student_name: student.full_name,
          summary: { total_due: 0, total_paid: 0, total_discount: 0, balance: 0 },
          fee_breakdown: [],
          payments: [],
        }),
      ),
      http.get('/api/v1/students/:id/wallet', () =>
        HttpResponse.json({ balance: 0, transactions: [] }),
      ),
      http.get('/api/v1/students/:studentId/discount-rules', () => HttpResponse.json(rules)),
    );

    return renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1?tab=fees'],
      tenantId: 'tenant-1',
      role: options.role ?? 'ADMIN',
      locale: 'en',
    });
  }

  async function openDiscountsTab() {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Discounts' }));
    return within(await screen.findByRole('tabpanel', { name: 'Discounts' }));
  }

  // These two are mounted standalone (`renderWithProviders`, not the full
  // route tree) and run *before* any `renderDiscountsTab` test below.
  // `useApprovedMutation`'s modal-host slot is a module-level singleton
  // (`approval.tsx`'s `hostClaimed`) with no test-scoped reset, and the
  // Fees tab always renders `RecordPaymentModal`, which unconditionally
  // calls `useCheckout()` (`record-payment-modal.tsx:244`) and so claims
  // that slot for the rest of the file once any full-page test has run.
  // Running standalone first avoids fighting that pre-existing
  // contention rather than papering over it — same standalone-mount
  // reasoning `FeesSection.test.tsx` uses for its own approval-gated
  // section. Do not reorder these below the `renderDiscountsTab` tests.
  it('adding a rule that gets a 403 APPROVAL_REQUIRED opens the approval flow, not a generic error', async () => {
    server.use(
      http.get('/api/v1/students/:studentId/discount-rules', () => HttpResponse.json([])),
      http.post('/api/v1/discount-rules', () =>
        HttpResponse.json(
          {
            ...apiErrorBody(403, 'Approval required', '/discount-rules'),
            details: { code: 'APPROVAL_REQUIRED', scope: 'discount_rules.manage' },
          },
          { status: 403 },
        ),
      ),
    );
    renderWithProviders(<DiscountsSection studentId="student-1" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add discount rule' }));

    await user.type(await screen.findByLabelText('Value'), '15');
    await user.type(screen.getByLabelText('Reason'), 'New sibling discount');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByLabelText('Email or phone')).toBeTruthy();
  });

  it('delete asks for confirmation before firing the mutation', async () => {
    let deleteCalls = 0;
    server.use(
      http.get('/api/v1/students/:studentId/discount-rules', () =>
        HttpResponse.json([discountRule()]),
      ),
      http.delete('/api/v1/discount-rules/:id', () => {
        deleteCalls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithProviders(<DiscountsSection studentId="student-1" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });
    const user = userEvent.setup();
    await screen.findByText('Sibling discount');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const confirmDialog = await screen.findByRole('dialog');
    expect(within(confirmDialog).getByText('Delete this discount rule?')).toBeTruthy();
    expect(deleteCalls).toBe(0);

    // Cancel: dialog closes, nothing fired.
    await user.click(within(confirmDialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(deleteCalls).toBe(0);

    // Re-open and confirm: only now does the mutation fire.
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const reopenedDialog = await screen.findByRole('dialog');
    await user.click(within(reopenedDialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteCalls).toBe(1));
  });

  it('shows the failure and lets the user retry when delete fails, instead of silently discarding it', async () => {
    server.use(
      http.get('/api/v1/students/:studentId/discount-rules', () =>
        HttpResponse.json([discountRule()]),
      ),
      http.delete('/api/v1/discount-rules/:id', () =>
        HttpResponse.json({ message: 'Rule already applied to a bill' }, { status: 409 }),
      ),
    );
    renderWithProviders(<DiscountsSection studentId="student-1" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });
    const user = userEvent.setup();
    await screen.findByText('Sibling discount');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const confirmDialog = await screen.findByRole('dialog');
    await user.click(within(confirmDialog).getByRole('button', { name: 'Delete' }));

    expect((await screen.findByRole('alert')).textContent).toBeTruthy();
    // The row is still there -- a real deletion never happened, unlike
    // the old behavior where onSettled cleared the delete state and
    // discarded the error regardless of success or failure.
    expect(screen.getByText('Sibling discount')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lists existing discount rules', async () => {
    renderDiscountsTab([discountRule()]);
    const panel = await openDiscountsTab();

    expect(await panel.findByText('Sibling discount')).toBeTruthy();
    expect(panel.getByText('10%')).toBeTruthy();
  });

  it('shows an empty state with no rules', async () => {
    renderDiscountsTab([]);
    const panel = await openDiscountsTab();

    expect(await panel.findByText('No discount rules yet.')).toBeTruthy();
  });

  it('hides add/edit/delete for a role without FEE_COLLECT', async () => {
    renderDiscountsTab([discountRule()], { role: 'TEACHER' });
    const panel = await openDiscountsTab();

    await panel.findByText('Sibling discount');
    expect(screen.queryByRole('button', { name: 'Add discount rule' })).toBeNull();
    expect(panel.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
