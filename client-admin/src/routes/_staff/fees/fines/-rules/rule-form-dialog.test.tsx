/**
 * [38.4a] Create/edit fine-rule dialog — #1120's own Tests list:
 * ATTENDANCE_LATE shows the min-minutes field and ATTENDANCE_ABSENT hides
 * it, a 409 duplicate is shown inline, and the submit payload shape.
 */
import {
  academicYearFactory,
  classFactory,
  cleanupTestState,
  feeStructureFactory,
  renderWithProviders,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuleFormDialog } from './rule-form-dialog';

function paginated<T>(rows: T[]) {
  return { data: rows, total: rows.length, page: 1, limit: 50, totalPages: 1 };
}

const YEAR = academicYearFactory({ id: 'year-1', name: '2026-2027' });
const CLASS = classFactory({ id: 'class-1', name: 'Class 6', academic_year: YEAR });
const FEE = feeStructureFactory({ id: 'fee-1', name: 'Fine Fee', academic_year: YEAR });

function referenceHandlers() {
  return [
    http.get('/api/v1/fee-structures', () => HttpResponse.json(paginated([FEE]))),
    http.get('/api/v1/classes', () => HttpResponse.json(paginated([CLASS]))),
  ];
}

describe('fees/fines/-rules/rule-form-dialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the min-minutes-late field only for ATTENDANCE_LATE', async () => {
    server.use(...referenceHandlers());
    renderWithProviders(
      <RuleFormDialog
        open
        onOpenChange={vi.fn()}
        mode="create"
        academicYearId={YEAR.id}
        onSaved={vi.fn()}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
    );

    const user = userEvent.setup();
    const triggerSelect = await screen.findByRole('combobox', {
      name: 'Trigger',
    });

    // ATTENDANCE_ABSENT is the default trigger — no min-minutes field yet.
    expect(screen.queryByLabelText('Minimum minutes late')).toBeNull();

    await user.click(triggerSelect);
    await user.click(await screen.findByRole('option', { name: 'Late arrivals' }));

    expect(await screen.findByLabelText('Minimum minutes late')).toBeTruthy();
  });

  it('shows a 409 duplicate message inline', async () => {
    server.use(...referenceHandlers());
    server.use(
      http.post('/api/v1/fees/fine-rules', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'An active fine rule already exists for this year, trigger and class',
            requestId: 'req-1',
            path: '/api/v1/fees/fine-rules',
            timestamp: new Date().toISOString(),
          },
          { status: 409 },
        ),
      ),
    );
    renderWithProviders(
      <RuleFormDialog
        open
        onOpenChange={vi.fn()}
        mode="create"
        academicYearId={YEAR.id}
        onSaved={vi.fn()}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Fine type' }));
    await user.click(await screen.findByRole('option', { name: 'Fine Fee' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        'An active fine rule already exists for this year, trigger and class',
      ),
    ).toBeTruthy();
  });

  it('submits the create payload shape', async () => {
    server.use(...referenceHandlers());
    let submittedBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/fees/fine-rules', async ({ request }) => {
        submittedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 'rule-1' }, { status: 201 });
      }),
    );
    const onSaved = vi.fn();
    renderWithProviders(
      <RuleFormDialog
        open
        onOpenChange={vi.fn()}
        mode="create"
        academicYearId={YEAR.id}
        onSaved={onSaved}
      />,
      { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' },
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Trigger' }));
    await user.click(await screen.findByRole('option', { name: 'Late arrivals' }));
    await user.click(screen.getByRole('combobox', { name: 'Fine type' }));
    await user.click(await screen.findByRole('option', { name: 'Fine Fee' }));
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 6' }));

    const minMinutes = await screen.findByLabelText('Minimum minutes late');
    await user.clear(minMinutes);
    await user.type(minMinutes, '15');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(submittedBody).toEqual({
      academic_year_id: YEAR.id,
      trigger: 'ATTENDANCE_LATE',
      fee_structure_id: FEE.id,
      class_id: CLASS.id,
      free_per_period: 0,
      conditions: { min_minutes_late: 15 },
    });
  });
});
