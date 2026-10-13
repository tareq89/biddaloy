import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TransferDialog } from './-transfer-dialog';

function mockApi(onPatch: (body: unknown) => void = () => {}) {
  server.use(
    http.get('/api/v1/enrollments/s1/current', () =>
      HttpResponse.json({
        id: 'e1',
        student_id: 's1',
        class_id: 'c1',
        section_id: 'sec1',
        academic_year_id: 'y1',
      }),
    ),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: [
          { id: 'c1', name: 'Class 5', academic_year_id: 'y1' },
          { id: 'c2', name: 'Class 6', academic_year_id: 'y1' },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes/:id/sections', () =>
      HttpResponse.json([{ id: 'sec1', section_name: 'A', capacity: 40, enrolled_count: 3 }]),
    ),
    http.patch('/api/v1/enrollments/e1', async ({ request }) => {
      onPatch(await request.json());
      return HttpResponse.json({ id: 'e1' });
    }),
  );
}

async function renderDialog(role: string) {
  const view = renderWithProviders(
    <TransferDialog open onOpenChange={vi.fn()} studentId="s1" studentName="Karim" />,
    { tenantId: 'tenant-1', locale: 'en', role },
  );
  await view.localeReady;
  return userEvent.setup();
}

describe('TransferDialog class lock [68.3.17.1]', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('without PROMOTION_MANAGE the class picker is disabled and the PATCH sends the current class_id', async () => {
    const patch = vi.fn();
    mockApi(patch);
    const user = await renderDialog('ACCOUNTANT');
    const classPicker = await screen.findByRole('combobox', { name: 'Class' });
    expect(classPicker.hasAttribute('disabled')).toBe(true);
    expect(
      await screen.findByText('Only an admin can move a student to another class; use promotion.'),
    ).toBeTruthy();

    await user.click(screen.getByRole('combobox', { name: 'Section' }));
    await user.click(await screen.findByRole('option', { name: 'A' }));
    await user.click(screen.getByRole('button', { name: 'Move' }));
    await vi.waitFor(() =>
      expect(patch).toHaveBeenCalledWith({ class_id: 'c1', section_id: 'sec1' }),
    );
  });

  it('with PROMOTION_MANAGE the class picker is enabled', async () => {
    mockApi();
    await renderDialog('ADMIN');
    const classPicker = await screen.findByRole('combobox', { name: 'Class' });
    expect(classPicker.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/use promotion/)).toBeNull();
  });
});
