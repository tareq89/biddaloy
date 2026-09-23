import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { fireEvent, screen } from '@testing-library/react';
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
});
