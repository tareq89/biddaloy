import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShiftsPanel } from './shifts-panel';

const SCHOOL_ID = 'school-1';

const SHIFT = {
  id: 'shift-1',
  name: 'Morning',
  day_starts_at: '08:00',
  day_ends_at: '13:00',
  sequence: 0,
};

describe('ShiftsPanel', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists existing shifts', async () => {
    server.use(
      http.get('*/routines/shifts', () =>
        HttpResponse.json({ data: [SHIFT], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
    );

    renderWithProviders(<ShiftsPanel selectedShiftId={undefined} onSelectShift={vi.fn()} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    expect(await screen.findByText('Morning')).toBeTruthy();
  });

  it('surfaces the server refusal when deleting a still-referenced shift', async () => {
    server.use(
      http.get('*/routines/shifts', () =>
        HttpResponse.json({ data: [SHIFT], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.delete('*/routines/shifts/:id', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message:
              'Cannot delete shift "shift-1": 2 period slot(s) still reference it. Remove them first.',
            timestamp: new Date().toISOString(),
            path: '/routines/shifts/shift-1',
            requestId: 'req-1',
          },
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(<ShiftsPanel selectedShiftId={undefined} onSelectShift={vi.fn()} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText(/still reference it/, { selector: '[role="alert"]' }),
    ).toBeTruthy();
  });

  it('adds a new shift and clears the name field, highlighting the selected shift', async () => {
    server.use(
      http.get('*/routines/shifts', () =>
        HttpResponse.json({ data: [SHIFT], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.post('*/routines/shifts', () =>
        HttpResponse.json({ ...SHIFT, id: 'shift-2', name: 'Evening', sequence: 1 }),
      ),
    );

    renderWithProviders(<ShiftsPanel selectedShiftId="shift-1" onSelectShift={vi.fn()} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: SCHOOL_ID,
    });

    expect((await screen.findByRole('button', { name: 'Morning' })).className).toMatch(/underline/);

    const user = userEvent.setup();
    const nameInput = screen.getByLabelText('Name');
    await user.type(nameInput, 'Evening');
    await user.click(screen.getByRole('button', { name: 'Add shift' }));

    await waitFor(() => expect((nameInput as HTMLInputElement).value).toBe(''));
  });
});
