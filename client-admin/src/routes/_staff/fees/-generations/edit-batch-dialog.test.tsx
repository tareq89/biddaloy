/**
 * [16.3.7] `EditBatchDialog` — the ticket's own `## Tests` "409 rendering"
 * case: a `PATCH` conflict lists the colliding students inline rather than
 * a generic error toast.
 */
import { apiErrorBody, cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { EditBatchDialog } from './edit-batch-dialog';

afterEach(async () => {
  await cleanupTestState();
});

const GENERATION = {
  id: 'gen-1',
  period_start: '2026-09-01T00:00:00.000Z',
  period_type: 'MONTH' as const,
  due_date: '2026-09-10T00:00:00.000Z',
};

function render() {
  return renderWithProviders(
    <EditBatchDialog
      open
      onOpenChange={() => {}}
      generation={GENERATION}
      hasCollectedBills={false}
      onSaved={() => {}}
    />,
    { locale: 'en', tenantId: 'tenant-1' },
  );
}

describe('EditBatchDialog', () => {
  it('renders the conflicting students inline on a 409 PATCH response', async () => {
    server.use(
      http.patch('/api/v1/fees/generations/gen-1', () =>
        HttpResponse.json(
          {
            ...apiErrorBody(409, 'Conflict', '/fees/generations/gen-1'),
            details: {
              students: [
                { id: 's1', full_name: 'Abdul Karim' },
                { id: 's2', full_name: 'Fatema Begum' },
              ],
            },
          },
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    const { localeReady } = render();
    await localeReady;

    await user.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('Abdul Karim')).toBeTruthy());
    expect(screen.getByText('Fatema Begum')).toBeTruthy();
    expect(
      screen.getByText('This period already conflicts with an existing batch for:'),
    ).toBeTruthy();
  });
});
