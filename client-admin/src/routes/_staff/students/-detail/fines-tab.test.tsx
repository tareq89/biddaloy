import { cleanupTestState, renderWithRouter, server, studentFactory } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** [38.4.4] Student detail's "Fines" tab — real route tree via
 * `/students/$studentId`, same reasoning `recurring-fees-tab.test.tsx`
 * gives for its own tab test: `FinesTab` is only ever mounted through that
 * route's tab wiring. */
describe('students/-detail/fines-tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function fineFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: 'fine-1',
      student_id: 'student-1',
      fee_structure_id: 'fee-structure-1',
      fee_name: 'Late fine',
      total_amount: 100,
      paid_amount: 0,
      discount_amount: 0,
      status: 'PENDING',
      note: 'Arrived late to assembly',
      incident_date: '2026-01-05',
      origin: 'MANUAL',
      ...overrides,
    };
  }

  function renderFinesTab(options: { fines?: unknown[]; role?: string } = {}) {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin' });
    const fines = options.fines ?? [fineFixture()];

    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.get('/api/v1/students/:studentId/promotion-overrides', () => HttpResponse.json([])),
      http.get('/api/v1/fees/fines', () =>
        HttpResponse.json({
          items: fines,
          total: fines.length,
          totals: { charged: 100, collected: 0, waived: 0, outstanding: 100 },
        }),
      ),
    );

    return renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1?tab=fines'],
      tenantId: 'tenant-1',
      role: options.role ?? 'ADMIN',
      locale: 'en',
    });
  }

  it('lists fines including a waived one', async () => {
    renderFinesTab({
      fines: [
        fineFixture({ id: 'fine-1', status: 'PENDING' }),
        fineFixture({ id: 'fine-2', status: 'WAIVED', note: 'Waived for good conduct' }),
      ],
    });

    await screen.findByRole('tab', { name: 'Fines', selected: true });

    // Both the phone-card and desktop-table renderings mount at once in
    // jsdom (the `sm:hidden`/`hidden sm:table` split is CSS-only, not
    // actually absent from the DOM), so each fine's text appears twice.
    expect((await screen.findAllByText('Arrived late to assembly')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Waived for good conduct')).length).toBeGreaterThan(0);
  });

  it('shows the empty state when the student has no fines', async () => {
    renderFinesTab({ fines: [] });

    await screen.findByRole('tab', { name: 'Fines', selected: true });

    expect(await screen.findByText('No fines yet')).toBeTruthy();
  });

  it('opens Log fine with the student prefilled', async () => {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/fee-structures', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
    );
    renderFinesTab();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Log fine' }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Remove Rahim Uddin')).toBeTruthy());
  });

  it('hides Waive for ACCOUNTANT, which has FEE_GENERATE but not FEE_APPROVE', async () => {
    renderFinesTab({ role: 'ACCOUNTANT' });

    await screen.findByRole('tab', { name: 'Fines', selected: true });
    await screen.findAllByText('Arrived late to assembly');

    expect(screen.getByRole('button', { name: 'Log fine' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Waive fine' })).toBeNull();
  });

  it('hides Waive for a fine that is already PAID, even for an ADMIN', async () => {
    renderFinesTab({ fines: [fineFixture({ status: 'PAID', paid_amount: 100 })] });

    await screen.findByRole('tab', { name: 'Fines', selected: true });
    await screen.findAllByText('Arrived late to assembly');

    expect(screen.queryByRole('button', { name: 'Waive fine' })).toBeNull();
  });
});
