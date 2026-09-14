import type { GenerateFeesPreviewResult } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DuplicatesStep } from './duplicates-step';

function preview(overrides: Partial<GenerateFeesPreviewResult> = {}): GenerateFeesPreviewResult {
  return {
    students_evaluated: 1,
    will_generate: 0,
    duplicates: [
      {
        student_id: 'student-1',
        student_name: 'Rahim Uddin',
        fee_structure_id: 'fee-1',
        fee_structure_name: 'Tuition',
        existing_fee_id: 'existing-1',
        existing_created_at: new Date().toISOString(),
      },
    ],
    inactive_students: [],
    ...overrides,
  };
}

describe('DuplicatesStep', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists the duplicate rows and reports the chosen action on change', async () => {
    const onActionChange = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <DuplicatesStep preview={preview()} action="SKIP" onActionChange={onActionChange} />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    await screen.findByText('Rahim Uddin already has Tuition');

    await user.click(screen.getByRole('radio', { name: /Create anyway/ }));
    expect(onActionChange).toHaveBeenCalledWith('CREATE_ANYWAY');
  });

  it('shows the inactive-student count when the preview reports any', async () => {
    const { localeReady } = renderWithProviders(
      <DuplicatesStep
        preview={preview({ inactive_students: [{ student_id: 's2', student_name: 'Karim' }] })}
        action="SKIP"
        onActionChange={vi.fn()}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    await screen.findByText(/1 of the selected students are not active/);
  });
});
