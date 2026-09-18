import type { GenerateFeesPreviewResult } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DuplicatesStep } from './duplicates-step';

// Matches `GenerateFeesPreviewResultDto`/`DuplicateBillDto`/
// `InactiveStudentDto` on the server exactly — this fixture used to encode
// fields the server never sends (`student_name`, `fee_structure_name`,
// `existing_fee_id`, `existing_created_at`), which is why the real bug
// (undefined.length crashing `onSuccess`) was invisible here.
function preview(overrides: Partial<GenerateFeesPreviewResult> = {}): GenerateFeesPreviewResult {
  return {
    students_total: 1,
    would_generate: 0,
    duplicates: [
      {
        student_id: 'student-1',
        fee_structure_id: 'fee-1',
        existing_bill_id: 'existing-1',
        paid_amount: 500,
      },
    ],
    inactive: [],
    ...overrides,
  };
}

const studentNames = new Map([['student-1', 'Rahim Uddin']]);
const feeStructureNames = new Map([['fee-1', 'Tuition']]);

describe('DuplicatesStep', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists the duplicate rows and reports the chosen action on change', async () => {
    const onActionChange = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <DuplicatesStep
        preview={preview()}
        action="SKIP"
        onActionChange={onActionChange}
        studentNames={studentNames}
        feeStructureNames={feeStructureNames}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    await screen.findByText('Rahim Uddin already has Tuition');

    await user.click(screen.getByRole('radio', { name: /Create anyway/ }));
    expect(onActionChange).toHaveBeenCalledWith('CREATE_ANYWAY');
  });

  it('falls back to the raw id when a name lookup is missing', async () => {
    const { localeReady } = renderWithProviders(
      <DuplicatesStep
        preview={preview()}
        action="SKIP"
        onActionChange={vi.fn()}
        studentNames={new Map()}
        feeStructureNames={new Map()}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    await screen.findByText('student-1 already has fee-1');
  });

  it('shows the inactive-student count when the preview reports any', async () => {
    const { localeReady } = renderWithProviders(
      <DuplicatesStep
        preview={preview({ inactive: [{ id: 's2', full_name: 'Karim' }] })}
        action="SKIP"
        onActionChange={vi.fn()}
        studentNames={studentNames}
        feeStructureNames={feeStructureNames}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    await screen.findByText(/1 of the selected students are not active/);
  });
});
