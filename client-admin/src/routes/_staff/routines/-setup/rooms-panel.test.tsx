import '@biddaloy/ui/test';

import { toast } from '@biddaloy/ui/components';
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoomsPanel } from './rooms-panel';

const SCHOOL_ID = 'school-1';

const ROOM = { id: 'room-1', building: 'Main', room_no: '101', capacity: 30 };

function mockRooms(data: unknown[]) {
  server.use(
    http.get('*/routines/rooms', () =>
      HttpResponse.json({ data, total: data.length, page: 1, limit: 100, totalPages: 1 }),
    ),
  );
}

function renderPanel() {
  return renderWithProviders(<RoomsPanel />, { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID });
}

describe('RoomsPanel', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists existing rooms as a table with the building and capacity', async () => {
    mockRooms([ROOM]);
    renderPanel();

    expect(await screen.findByText('Room 101')).toBeTruthy();
    expect(screen.getByText('Main')).toBeTruthy();
    expect(screen.getByText(`${formatNumber(30, REGION_BD_BN)} seats`)).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Rooms' })).toBeTruthy();
  });

  it('shows an empty state with no rooms', async () => {
    mockRooms([]);
    renderPanel();

    expect(await screen.findByRole('heading', { name: 'No rooms yet' })).toBeTruthy();
  });

  it('asks before deleting, and a 409 shows the translated sentence, never the server message', async () => {
    mockRooms([ROOM]);
    let deleted = false;
    server.use(
      http.delete('*/routines/rooms/:id', () => {
        deleted = true;
        return HttpResponse.json(
          {
            statusCode: 409,
            message:
              'Cannot delete room "room-1": 1 routine slot(s) still reference it. Reassign or remove them first.',
            timestamp: new Date().toISOString(),
            path: '/routines/rooms/room-1',
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
      expect(await screen.findByRole('alertdialog')).toBeTruthy();
      expect(screen.getByText('Delete room 101?')).toBeTruthy();
      expect(deleted).toBe(false);

      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
      );
      await waitFor(() =>
        expect(errorSpy).toHaveBeenCalledWith(
          "Periods in the routine use this room, so it can't be deleted. Move those periods to another room first.",
        ),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('shows — for a room with no building or capacity, and adds a room from the dialog', async () => {
    mockRooms([{ id: 'room-2', building: null, room_no: '202', capacity: null }]);
    let posted: unknown = null;
    server.use(
      http.post('*/routines/rooms', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ id: 'room-3', building: null, room_no: '303', capacity: null });
      }),
    );
    renderPanel();

    expect(await screen.findByText('Room 202')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add room' }));
    await user.type(await screen.findByLabelText('Room no.'), '303');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(posted).toEqual({ building: null, room_no: '303', capacity: null }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('adds a room with a building and capacity filled in', async () => {
    mockRooms([]);
    let posted: unknown = null;
    server.use(
      http.post('*/routines/rooms', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ id: 'room-4', building: 'Annex', room_no: '404', capacity: 25 });
      }),
    );
    renderPanel();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add room' }));
    await user.type(await screen.findByLabelText('Building'), 'Annex');
    await user.type(screen.getByLabelText('Room no.'), '404');
    await user.type(screen.getByLabelText('Capacity'), '25');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(posted).toEqual({ building: 'Annex', room_no: '404', capacity: 25 }),
    );
  });
});
