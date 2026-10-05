import '@biddaloy/ui/test';

import { toast } from '@biddaloy/ui/components';
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { formatTime } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShiftsPanel } from './shifts-panel';

const SCHOOL_ID = 'school-1';

const SHIFT = {
  id: 'shift-1',
  name: 'Morning',
  day_starts_at: '08:00:00',
  day_ends_at: '13:00:00',
  sequence: 0,
};

function mockShifts() {
  server.use(
    http.get('*/routines/shifts', () =>
      HttpResponse.json({ data: [SHIFT], total: 1, page: 1, limit: 100, totalPages: 1 }),
    ),
  );
}

function renderPanel() {
  return renderWithProviders(<ShiftsPanel />, {
    locale: 'en',
    role: 'ADMIN',
    tenantId: SCHOOL_ID,
  });
}

describe('ShiftsPanel', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists shifts with formatted times, never the raw 08:00:00', async () => {
    mockShifts();
    renderPanel();

    expect(await screen.findByText('Morning')).toBeTruthy();
    expect(screen.getAllByText(formatTime('08:00:00', REGION_BD_BN)).length).toBeGreaterThan(0);
    expect(screen.queryByText('08:00:00')).toBeNull();
  });

  it('asks before deleting, and a 409 shows the translated sentence, never the server message', async () => {
    mockShifts();
    let deleted = false;
    server.use(
      http.delete('*/routines/shifts/:id', () => {
        deleted = true;
        return HttpResponse.json(
          {
            statusCode: 409,
            message:
              'Cannot delete shift "shift-1": 2 period slot(s) still reference it. Remove them first.',
            timestamp: new Date().toISOString(),
            path: '/routines/shifts/shift-1',
            requestId: 'req-1',
          },
          { status: 409 },
        );
      }),
    );
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    try {
      renderPanel();
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('Delete Morning?')).toBeTruthy();
      expect(deleted).toBe(false);

      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() =>
        expect(errorSpy).toHaveBeenCalledWith(
          "This shift still has period times, so it can't be deleted. Remove its rows under Period times first.",
        ),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('adds a shift from a dialog with two time pickers and the same payload as before', async () => {
    mockShifts();
    let posted: unknown = null;
    server.use(
      http.post('*/routines/shifts', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ ...SHIFT, id: 'shift-2', name: 'Evening', sequence: 1 });
      }),
    );
    const { container } = renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add shift' }));
    await user.type(await screen.findByLabelText('Name'), 'Evening');
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(container.querySelector('input[type="time"]')).toBeNull();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(posted).toEqual({
        name: 'Evening',
        day_starts_at: '08:00',
        day_ends_at: '16:00',
        sequence: 1,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
