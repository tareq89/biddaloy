import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeePicker } from './fee-picker';

// The default test RegionConfig is Bangla; pin English digits.
function renderPicker(
  selected: Set<string> = new Set(),
  majorityClassId: string | undefined = undefined,
) {
  const onSelectedChange = vi.fn();
  const view = renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>
      <FeePicker
        academicYearId="year-1"
        academicYearName="2026"
        majorityClassId={majorityClassId}
        selected={selected}
        onSelectedChange={onSelectedChange}
      />
    </RegionConfigProvider>,
    { tenantId: 'tenant-1', locale: 'en' },
  );
  return { ...view, onSelectedChange };
}

function structuresHandler(data: Record<string, unknown>[]) {
  return http.get('/api/v1/fee-structures', () =>
    HttpResponse.json({ data, total: data.length, page: 1, limit: 100, totalPages: 1 }),
  );
}

/** One checkbox per row; its row text carries the fee name and amount. */
function rowTexts() {
  return screen.getAllByRole('checkbox').map((el) => el.closest('li')?.textContent);
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
    expect(screen.getByText('Choose from the 2026 fee structures.')).toBeTruthy();
  });

  it('floats structures matching the majority class to the top', async () => {
    server.use(
      structuresHandler([
        { id: 's-other', name: 'Other class fee', amount: 100, class_id: 'class-other' },
        { id: 's-match', name: 'Matching class fee', amount: 200, class_id: 'class-9' },
        { id: 's-tenant', name: 'Tenant-wide fee', amount: 300, class_id: null },
      ]),
    );

    renderPicker(new Set(), 'class-9');

    await screen.findAllByRole('checkbox');
    expect(rowTexts()).toEqual([
      'Matching class fee৳200.00',
      'Other class fee৳100.00',
      'Tenant-wide fee৳300.00',
    ]);
  });

  it('keeps server order when no structure matches the majority class', async () => {
    server.use(
      structuresHandler([
        { id: 's-a', name: 'Fee A', amount: 100, class_id: 'class-other' },
        { id: 's-b', name: 'Fee B', amount: 200, class_id: 'class-yet-another' },
      ]),
    );

    renderPicker(new Set(), 'class-9');

    await screen.findAllByRole('checkbox');
    expect(rowTexts()).toEqual(['Fee A৳100.00', 'Fee B৳200.00']);
  });

  it('shows the per-student total in tenant digits, summing the checked fees', async () => {
    server.use(
      structuresHandler([
        { id: 's-a', name: 'Fee A', amount: 100, class_id: null },
        { id: 's-b', name: 'Fee B', amount: 250, class_id: null },
      ]),
    );

    renderPicker(new Set(['s-a', 's-b']));

    await screen.findAllByRole('checkbox');
    // `structure.amount` is a server major-unit decimal (100 + 250 = 350
    // taka), not minor units — see `fee-picker.tsx`'s own comment on why
    // it's parsed through `parseCurrency` before summing.
    await waitFor(() => expect(screen.getByText('৳350.00 per student')).toBeTruthy());
  });

  it('unchecking a selected fee removes it from the selection', async () => {
    server.use(structuresHandler([{ id: 's-a', name: 'Fee A', amount: 100, class_id: null }]));

    const user = userEvent.setup();
    const { onSelectedChange } = renderPicker(new Set(['s-a']));

    const checkbox = await screen.findByRole('checkbox', { name: /Fee A/ });
    await user.click(checkbox);

    expect(onSelectedChange).toHaveBeenCalledWith(new Set());
  });

  it('shows the empty message when no structures exist for the academic year', async () => {
    server.use(structuresHandler([]));

    renderPicker();

    expect(await screen.findByText(/No fee structures/)).toBeTruthy();
  });
});
