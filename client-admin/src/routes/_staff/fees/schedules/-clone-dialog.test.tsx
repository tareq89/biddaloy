/**
 * [16.7.5] "Clone next year" dialog — rendered directly, not through a
 * route of its own, matching `-schedule-form-dialog.test.tsx`'s
 * precedent for a modal with no route to mount through.
 */
import type { RecurringSchedule } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloneScheduleDialog } from './-clone-dialog';

function paginated<T>(rows: T[]) {
  return { data: rows, total: rows.length, page: 1, limit: 50, totalPages: 1 };
}

const SCHEDULE = {
  id: 'schedule-1',
  name: 'Monthly tuition',
  academic_year_id: 'year-1',
  fee_structure_ids: ['fee-1'],
  audience: { enrollment_status: 'ACTIVE' },
  rule: { kind: 'MONTHLY', day_of_month: 1 },
  period_type: 'MONTH',
  due_days_after_period_start: 7,
  starts_on: '2026-01-01',
  ends_on: '',
  notify_families: false,
  is_active: true,
  last_run_period: null,
  created_at: '2026-01-01T00:00:00.000Z',
} as unknown as RecurringSchedule;

function referenceHandlers() {
  return [
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json(
        paginated([
          { id: 'year-1', name: '2026-2027', start_date: '2026-01-01', end_date: '2026-12-31' },
          { id: 'year-2', name: '2027-2028', start_date: '2027-01-01', end_date: '2027-12-31' },
        ]),
      ),
    ),
  ];
}

describe('fees/schedules/-clone-dialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it("excludes the schedule's own academic year from the target-year picker", async () => {
    server.use(...referenceHandlers());
    const onOpenChange = vi.fn();
    const onCloned = vi.fn();
    renderWithProviders(
      <CloneScheduleDialog
        open
        onOpenChange={onOpenChange}
        schedule={SCHEDULE}
        onCloned={onCloned}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Academic year' }));

    expect(await screen.findByRole('option', { name: '2027-2028' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '2026-2027' })).toBeNull();
  });

  it('submits the clone request and calls onCloned on success', async () => {
    server.use(...referenceHandlers());
    let submittedBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/fees/schedules/:id/clone', async ({ request }) => {
        submittedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...SCHEDULE, id: 'schedule-2' }, { status: 201 });
      }),
    );
    const onCloned = vi.fn();
    renderWithProviders(
      <CloneScheduleDialog open onOpenChange={vi.fn()} schedule={SCHEDULE} onCloned={onCloned} />,
      { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
    );

    const user = userEvent.setup();
    // Submit stays disabled until a target year is picked.
    expect(screen.getByRole('button', { name: 'Clone' }).hasAttribute('disabled')).toBe(true);

    await user.click(await screen.findByRole('combobox', { name: 'Academic year' }));
    await user.click(await screen.findByRole('option', { name: '2027-2028' }));
    await user.click(screen.getByRole('button', { name: 'Clone' }));

    await waitFor(() => expect(onCloned).toHaveBeenCalled());
    expect(submittedBody).toEqual({ academic_year_id: 'year-2' });
  });

  it('shows an error message when the clone request fails', async () => {
    server.use(...referenceHandlers());
    server.use(
      http.post('/api/v1/fees/schedules/:id/clone', () =>
        HttpResponse.json({ message: 'Could not clone' }, { status: 500 }),
      ),
    );
    renderWithProviders(
      <CloneScheduleDialog open onOpenChange={vi.fn()} schedule={SCHEDULE} onCloned={vi.fn()} />,
      { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Academic year' }));
    await user.click(await screen.findByRole('option', { name: '2027-2028' }));
    await user.click(screen.getByRole('button', { name: 'Clone' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
