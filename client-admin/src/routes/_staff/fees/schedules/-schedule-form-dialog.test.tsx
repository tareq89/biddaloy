/**
 * [16.7.5] Create/Edit schedule dialog — rendered directly, not through
 * a routed page, matching `record-payment-modal.test.tsx`'s precedent
 * for a modal with no route of its own to mount through.
 *
 * Covers issue #679's own Tests list: the rule editor round-trips
 * (set monthly, save, reopen in edit mode, same rule shown) and ends-on
 * gets capped to the selected academic year's end date.
 *
 * The submitted-body assertions are deliberately exact (`toEqual`, not
 * `toMatchObject`). An earlier version of this file asserted the dialog's
 * own hand-typed interim shape (`rule.mode`, `audience.active_only`),
 * which meant the test passed while every real request was rejected by
 * the server for a missing `rule.kind` / `audience.enrollment_status`.
 * Assert the shape `CreateRecurringScheduleDto` actually validates.
 */
import type { RecurringSchedule } from '@biddaloy/ui/hooks';
import {
  academicYearFactory,
  cleanupTestState,
  feeStructureFactory,
  renderWithProviders,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScheduleFormDialog } from './-schedule-form-dialog';

const YEAR = academicYearFactory({
  id: 'year-1',
  name: '2026-2027',
  start_date: '2026-01-01T00:00:00.000Z',
  end_date: '2026-12-31T00:00:00.000Z',
});
const FEE = feeStructureFactory({ id: 'fee-1', name: 'Monthly Tuition', academic_year: YEAR });

function paginated<T>(rows: T[]) {
  return { data: rows, total: rows.length, page: 1, limit: 50, totalPages: 1 };
}

function referenceHandlers() {
  return [
    http.get('/api/v1/academic-years', () => HttpResponse.json(paginated([YEAR]))),
    http.get('/api/v1/fee-structures', () => HttpResponse.json(paginated([FEE]))),
    http.get('/api/v1/classes', () => HttpResponse.json(paginated([]))),
  ];
}

function schedule(overrides: Partial<RecurringSchedule> = {}): RecurringSchedule {
  return {
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
    ...overrides,
  };
}

async function renderDialog(props: Partial<React.ComponentProps<typeof ScheduleFormDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const view = renderWithProviders(
    <ScheduleFormDialog
      open
      onOpenChange={onOpenChange}
      mode="create"
      onSaved={onSaved}
      {...props}
    />,
    { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' },
  );
  await view.localeReady;
  return { ...view, onOpenChange, onSaved };
}

describe('ScheduleFormDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('creates a monthly-rule schedule and submits the chosen day of month', async () => {
    server.use(...referenceHandlers());
    let submittedBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/fees/schedules', async ({ request }) => {
        submittedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(schedule({ ...(submittedBody as object) }));
      }),
    );

    const { onSaved } = await renderDialog();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Monthly tuition');
    await user.click(await screen.findByRole('combobox', { name: 'Academic year' }));
    await user.click(await screen.findByRole('option', { name: '2026-2027' }));
    await waitFor(() => expect(screen.getByLabelText('Monthly Tuition')).toBeTruthy());
    await user.click(screen.getByLabelText('Monthly Tuition'));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // `kind`, not `mode` — `RecurringScheduleRuleDto.kind` is `@IsIn`
    // and required, so a body carrying `mode` is a 400.
    expect(submittedBody?.rule).toEqual({ kind: 'MONTHLY', day_of_month: 1 });
    // `enrollment_status` is required and `'ACTIVE'` is its only accepted
    // value; there is no `active_only` field on the server's audience DTO,
    // and `forbidNonWhitelisted` would reject one.
    expect(submittedBody?.audience).toEqual({ enrollment_status: 'ACTIVE' });
    expect(submittedBody?.audience).not.toHaveProperty('active_only');
    expect(submittedBody?.rule).not.toHaveProperty('mode');
  });

  it('submits ISO weekday numbers, not weekday name strings, for a weekly rule', async () => {
    server.use(...referenceHandlers());
    let submittedBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/fees/schedules', async ({ request }) => {
        submittedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(schedule({ ...(submittedBody as object) }));
      }),
    );

    const { onSaved } = await renderDialog();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Name'), 'Weekly transport');
    await user.click(await screen.findByRole('combobox', { name: 'Academic year' }));
    await user.click(await screen.findByRole('option', { name: '2026-2027' }));
    await waitFor(() => expect(screen.getByLabelText('Monthly Tuition')).toBeTruthy());
    await user.click(screen.getByLabelText('Monthly Tuition'));

    await user.click(await screen.findByRole('combobox', { name: 'Rule' }));
    await user.click(await screen.findByRole('option', { name: 'Weekly' }));
    // Chips are labelled from `common:weekdays.<iso>` — Mon = 1, Thu = 4.
    await user.click(await screen.findByRole('button', { name: 'Mon', pressed: false }));
    await user.click(screen.getByRole('button', { name: 'Thu', pressed: false }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // `recurrence.util.ts` reads ISO weekday numbers (1 = Monday .. 7 =
    // Sunday). The interim client sent `['MON', 'THU']`, which never
    // matched any day.
    expect(submittedBody?.rule).toEqual({ kind: 'WEEKLY', weekdays: [1, 4] });
  });

  it('round-trips a saved monthly rule when reopened in edit mode', async () => {
    server.use(...referenceHandlers());
    const existing = schedule({ rule: { kind: 'MONTHLY', day_of_month: 15 } });

    await renderDialog({ mode: 'edit', schedule: existing });

    const daySelect = await screen.findByLabelText('Day of month');
    expect(daySelect.textContent).toContain('15');
  });

  it('caps ends-on to the selected academic year end date', async () => {
    server.use(...referenceHandlers());
    const existing = schedule({ ends_on: '2027-06-30' });

    await renderDialog({ mode: 'edit', schedule: existing });

    // The year's `end_date` (2026-12-31) is earlier than the saved
    // `ends_on` (2027-06-30) — the clamp effect should pull it back.
    await waitFor(() => {
      const endsOnInput = screen.getByLabelText<HTMLInputElement>('Ends on');
      expect(endsOnInput.value).not.toContain('2027');
    });
  });
});
