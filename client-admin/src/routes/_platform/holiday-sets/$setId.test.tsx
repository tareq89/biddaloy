import { UserRole } from '@biddaloy/shared';
import { BD_2026_SET_ID, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * [17.3.5/#715] SUPER_ADMIN's platform holiday-set detail/editor page —
 * editing entries, saving the full array, and the publish toggle.
 */
function renderDetail(setId = BD_2026_SET_ID) {
  return renderWithRouter(routeTree, {
    initialEntries: [`/holiday-sets/${setId}`],
    tenantId: 'tenant-1',
    role: UserRole.SUPER_ADMIN,
    locale: 'en',
  });
}

describe('/holiday-sets/$setId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the set heading and its seeded entries', async () => {
    renderDetail();

    await screen.findByRole('heading', { name: 'BD 2026' });
    expect(screen.getByDisplayValue('International Mother Language Day')).toBeTruthy();
    expect(screen.getByDisplayValue('Independence Day')).toBeTruthy();
  });

  it('sends the full entries array when editing a row and saving', async () => {
    const user = userEvent.setup();
    let capturedBody: unknown;
    server.use(
      http.put('/api/v1/platform/holiday-sets/:id/entries', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          id: BD_2026_SET_ID,
          country: 'BD',
          year: 2026,
          source: 'NAGER_DATE',
          published_at: null,
          fetched_at: '2026-01-01T00:00:00.000Z',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-02-01T00:00:00.000Z',
          entries: [],
        });
      }),
    );

    renderDetail();
    await screen.findByRole('heading', { name: 'BD 2026' });

    const nameInput = screen.getByDisplayValue('International Mother Language Day');
    await user.clear(nameInput);
    await user.type(nameInput, 'Renamed Holiday');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(capturedBody).toBeTruthy());
    const body = capturedBody as { entries: { name: string }[] };
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]?.name).toBe('Renamed Holiday');
    expect(body.entries[1]?.name).toBe('Independence Day');
  });

  it('disables the publish toggle while there are unsaved changes', async () => {
    const user = userEvent.setup();
    renderDetail();

    await screen.findByRole('heading', { name: 'BD 2026' });
    // Seeded set is already published — its toggle button is "Unpublish".
    expect(screen.getByRole('button', { name: 'Unpublish' }).hasAttribute('disabled')).toBe(false);

    const nameInput = screen.getByDisplayValue('International Mother Language Day');
    await user.type(nameInput, ' (edited)');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Unpublish' }).hasAttribute('disabled')).toBe(true),
    );
  });
});
