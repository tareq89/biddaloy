import type { GenerateFeesPreviewResult } from '@biddaloy/ui/hooks';
import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
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

// The default test RegionConfig is Bangla; pin English digits.
function renderStep(props: Partial<React.ComponentProps<typeof DuplicatesStep>> = {}) {
  return renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>
      <DuplicatesStep
        preview={preview()}
        action="SKIP"
        onActionChange={vi.fn()}
        studentNames={studentNames}
        feeStructureNames={feeStructureNames}
        {...props}
      />
    </RegionConfigProvider>,
    { tenantId: 'tenant-1', locale: 'en' },
  );
}

describe('DuplicatesStep', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('names the duplicates and reports the chosen action on change', async () => {
    const onActionChange = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = renderStep({ onActionChange });
    await localeReady;

    expect(await screen.findByText('Some bills for this period already exist')).toBeTruthy();
    await screen.findByText('Rahim Uddin — Tuition');

    await user.click(screen.getByRole('radio', { name: /Create anyway/ }));
    expect(onActionChange).toHaveBeenCalledWith('CREATE_ANYWAY');
  });

  it('offers three radios named by their labels, each with its hint', async () => {
    const { localeReady } = renderStep();
    await localeReady;

    const group = await screen.findByRole('radiogroup', {
      name: 'What to do with existing bills',
    });
    expect(group).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: /Skip duplicates/ })).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: /Delete the old bill and create a new one/ }),
    ).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Create anyway/ })).toBeTruthy();
    expect(screen.getByText('Only students without a bill for this period get one.')).toBeTruthy();
  });

  it('never shows a raw id when a name lookup is missing', async () => {
    const { localeReady } = renderStep({
      studentNames: new Map(),
      feeStructureNames: new Map(),
    });
    await localeReady;

    await screen.findByText('Selected student (name loading…) — A fee');
    expect(screen.queryByText(/student-1|fee-1/)).toBeNull();
  });

  it('shows the inactive-student count when the preview reports any', async () => {
    const { localeReady } = renderStep({
      preview: preview({ inactive: [{ id: 's2', full_name: 'Karim' }] }),
    });
    await localeReady;

    await screen.findByText('1 of the selected students are not active.');
  });
});
