import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { RoomsPanel } from './rooms-panel';

const SCHOOL_ID = 'school-1';

const ROOM = { id: 'room-1', building: 'Main', room_no: '101', capacity: 30 };

describe('RoomsPanel', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists existing rooms', async () => {
    server.use(
      http.get('*/routines/rooms', () =>
        HttpResponse.json({ data: [ROOM], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
    );

    renderWithProviders(<RoomsPanel />, { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID });

    expect(await screen.findByText('101')).toBeTruthy();
  });

  it('surfaces the server refusal when deleting a still-referenced room', async () => {
    server.use(
      http.get('*/routines/rooms', () =>
        HttpResponse.json({ data: [ROOM], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.delete('*/routines/rooms/:id', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message:
              'Cannot delete room "room-1": 1 routine slot(s) still reference it. Reassign or remove them first.',
            timestamp: new Date().toISOString(),
            path: '/routines/rooms/room-1',
            requestId: 'req-1',
          },
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(<RoomsPanel />, { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID });

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText(/still reference it/, { selector: '[role="alert"]' }),
    ).toBeTruthy();
  });

  it('shows the — placeholder for a room with no building/capacity, and adds a new room', async () => {
    const BARE_ROOM = { id: 'room-2', building: null, room_no: '202', capacity: null };
    server.use(
      http.get('*/routines/rooms', () =>
        HttpResponse.json({ data: [BARE_ROOM], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.post('*/routines/rooms', () =>
        HttpResponse.json({ id: 'room-3', building: null, room_no: '303', capacity: null }),
      ),
    );

    renderWithProviders(<RoomsPanel />, { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID });

    expect(await screen.findByText('202')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);

    const user = userEvent.setup();
    const roomNoInput = screen.getByLabelText('Room no.');
    await user.type(roomNoInput, '303');
    await user.click(screen.getByRole('button', { name: 'Add room' }));

    await waitFor(() => expect((roomNoInput as HTMLInputElement).value).toBe(''));
  });

  it('adds a room with a building and capacity filled in', async () => {
    let posted: unknown = null;
    server.use(
      http.get('*/routines/rooms', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.post('*/routines/rooms', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ id: 'room-4', building: 'Annex', room_no: '404', capacity: 25 });
      }),
    );

    renderWithProviders(<RoomsPanel />, { locale: 'en', role: 'ADMIN', tenantId: SCHOOL_ID });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Building'), 'Annex');
    await user.type(screen.getByLabelText('Room no.'), '404');
    await user.type(screen.getByLabelText('Capacity'), '25');
    await user.click(screen.getByRole('button', { name: 'Add room' }));

    await waitFor(() =>
      expect(posted).toEqual({ building: 'Annex', room_no: '404', capacity: 25 }),
    );
  });
});
