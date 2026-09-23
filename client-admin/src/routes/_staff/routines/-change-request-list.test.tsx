import type { RoutineChangeRequest } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';


import { ChangeRequestList } from './-change-request-list';

afterEach(async () => {
  await cleanupTestState();
});

const REQUEST = {
  id: 'cr-1',
  routine_slot_id: 'slot-1',
  requested_by: 'user-1',
  note: 'Please move this period.',
  state: 'OPEN' as const,
  resolved_by: null,
  resolved_at: null,
  resolution_note: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as unknown as RoutineChangeRequest;

describe('ChangeRequestList', () => {
  it('accepting never edits the routine — only PATCHes the change request', async () => {
    let routinePatched = false;
    let patchedBody: unknown = null;
    server.use(
      http.patch('/api/v1/routines/change-requests/cr-1', async ({ request }) => {
        patchedBody = await request.json();
        return HttpResponse.json({ ...REQUEST, state: 'ACCEPTED' });
      }),
      http.patch('/api/v1/routines/slots/slot-1', () => {
        routinePatched = true;
        return HttpResponse.json({});
      }),
    );
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <ChangeRequestList
        routineId="routine-1"
        requests={[REQUEST]}
        slotLabel={() => 'Math'}
        requesterLabel={() => 'Ms Nahar'}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    await waitFor(() => expect(screen.getByText(/does not edit the routine/i)).toBeTruthy());
    expect(screen.getByText('Math')).toBeTruthy();
    expect(screen.getByText(/requested by Ms Nahar/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => expect(patchedBody).toEqual({ state: 'ACCEPTED' }));
    expect(routinePatched).toBe(false);
  });

  it('shows an empty state with no open requests', async () => {
    const { localeReady } = renderWithProviders(
      <ChangeRequestList
        routineId="routine-1"
        requests={[{ ...REQUEST, state: 'ACCEPTED' }]}
        slotLabel={() => 'Math'}
        requesterLabel={() => 'Ms Nahar'}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    expect(screen.getByText(/no open change requests/i)).toBeTruthy();
  });
});
