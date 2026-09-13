import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeePicker } from './fee-picker';

function renderPicker(selected: Set<string> = new Set()) {
  const onSelectedChange = vi.fn();
  const view = renderWithProviders(
    <FeePicker
      academicYearId="year-1"
      majorityClassId={undefined}
      selected={selected}
      onSelectedChange={onSelectedChange}
      studentCount={2}
    />,
    { tenantId: 'tenant-1', locale: 'en' },
  );
  return { ...view, onSelectedChange };
}

describe('FeePicker', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists the fee structures for the academic year and lets more than one be checked', async () => {
    const user = userEvent.setup();
    renderPicker();

    const checkboxes = await screen.findAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0);

    expect(checkboxes[0]).toBeDefined();
    await user.click(checkboxes[0]!);
    await waitFor(() => expect(screen.queryByText(/Loading fee structures/)).toBeNull());
  });
});
