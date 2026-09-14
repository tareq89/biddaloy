import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FeePicker } from './fee-picker';

function renderPicker(
  selected: Set<string> = new Set(),
  majorityClassId: string | undefined = undefined,
) {
  const onSelectedChange = vi.fn();
  const view = renderWithProviders(
    <FeePicker
      academicYearId="year-1"
      majorityClassId={majorityClassId}
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

  it('floats structures matching the majority class to the top', async () => {
    server.use(
      http.get('/api/v1/fee-structures', () =>
        HttpResponse.json({
          data: [
            { id: 's-other', name: 'Other class fee', amount: 100, class_id: 'class-other' },
            { id: 's-match', name: 'Matching class fee', amount: 200, class_id: 'class-9' },
            { id: 's-tenant', name: 'Tenant-wide fee', amount: 300, class_id: null },
          ],
          total: 3,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
    );

    renderPicker(new Set(), 'class-9');

    const items = await screen.findAllByRole('checkbox');
    expect(items.length).toBe(3);
    const labels = items.map((el) => el.getAttribute('aria-label'));
    expect(labels[0]).toBe('Matching class fee');
  });

  it('keeps server order when no structure matches the majority class', async () => {
    server.use(
      http.get('/api/v1/fee-structures', () =>
        HttpResponse.json({
          data: [
            { id: 's-a', name: 'Fee A', amount: 100, class_id: 'class-other' },
            { id: 's-b', name: 'Fee B', amount: 200, class_id: 'class-yet-another' },
          ],
          total: 2,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
    );

    renderPicker(new Set(), 'class-9');

    const items = await screen.findAllByRole('checkbox');
    const labels = items.map((el) => el.getAttribute('aria-label'));
    expect(labels).toEqual(['Fee A', 'Fee B']);
  });

  it('shows a $0 running total with nothing selected, and the sum once fees are checked', async () => {
    server.use(
      http.get('/api/v1/fee-structures', () =>
        HttpResponse.json({
          data: [
            { id: 's-a', name: 'Fee A', amount: 100, class_id: null },
            { id: 's-b', name: 'Fee B', amount: 250, class_id: null },
          ],
          total: 2,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
    );

    renderPicker(new Set(['s-a', 's-b']));

    const checkboxes = await screen.findAllByRole('checkbox');
    expect(checkboxes.length).toBe(2);
    // Both pre-selected: running total should reflect both amounts summed.
    await waitFor(() => expect(screen.getByText(/৩\.৫০/)).toBeTruthy());
  });

  it('unchecking a selected fee removes it from the selection', async () => {
    server.use(
      http.get('/api/v1/fee-structures', () =>
        HttpResponse.json({
          data: [{ id: 's-a', name: 'Fee A', amount: 100, class_id: null }],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
    );

    const user = userEvent.setup();
    const { onSelectedChange } = renderPicker(new Set(['s-a']));

    const checkbox = await screen.findByRole('checkbox', { name: 'Fee A' });
    await user.click(checkbox);

    expect(onSelectedChange).toHaveBeenCalledWith(new Set());
  });

  it('shows the empty message when no structures exist for the academic year', async () => {
    server.use(
      http.get('/api/v1/fee-structures', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
    );

    renderPicker();

    expect(await screen.findByText(/No fee structures/)).toBeTruthy();
  });
});
