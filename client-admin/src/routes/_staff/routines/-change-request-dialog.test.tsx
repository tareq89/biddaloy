import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChangeRequestDialog } from './-change-request-dialog';

afterEach(async () => {
  await cleanupTestState();
});

describe('ChangeRequestDialog', () => {
  it('submits a note as the whole payload', async () => {
    let posted: unknown = null;
    server.use(
      http.post('/api/v1/routines/slots/slot-1/change-requests', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ id: 'cr-1', state: 'OPEN' });
      }),
    );
    const onDone = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <ChangeRequestDialog
        open
        onOpenChange={vi.fn()}
        routineId="routine-1"
        slotId="slot-1"
        onDone={onDone}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /send/i })).toHaveProperty('disabled', true),
    );

    await user.type(screen.getByLabelText(/note/i), 'This clashes with my other class.');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(posted).toEqual({ note: 'This clashes with my other class.' }));
    expect(onDone).toHaveBeenCalled();
  });
});
