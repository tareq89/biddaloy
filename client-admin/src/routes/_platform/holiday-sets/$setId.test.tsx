import { UserRole } from '@biddaloy/shared';
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { BD_2026_SET_ID, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatDateTime } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
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

  it('renders the heading, translated facts and its seeded entries', async () => {
    renderDetail();

    await screen.findByRole('heading', { name: 'Bangladesh 2026', level: 1 });
    expect(screen.getByText('Nager.Date (online list)')).toBeTruthy();
    expect(screen.getByText(formatDateTime('2026-01-01T00:00:00.000Z', REGION_BD_BN))).toBeTruthy();
    expect(screen.queryByText('NAGER_DATE')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Back to holiday sets' })).toBeNull();
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
    await screen.findByRole('heading', { name: 'Bangladesh 2026', level: 1 });

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

  it('disables the publish toggle while there are unsaved changes and shows the hint as text', async () => {
    const user = userEvent.setup();
    renderDetail();

    await screen.findByRole('heading', { name: 'Bangladesh 2026', level: 1 });
    // Seeded set is already published — its toggle button is "Unpublish".
    expect(screen.getByRole('button', { name: 'Unpublish' }).hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText('Save your changes before publishing.')).toBeNull();

    const nameInput = screen.getByDisplayValue('International Mother Language Day');
    await user.type(nameInput, ' (edited)');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Unpublish' }).hasAttribute('disabled')).toBe(true),
    );
    expect(screen.getByText('Save your changes before publishing.')).toBeTruthy();
  });

  it('unpublish asks in an alertdialog before calling the API', async () => {
    const user = userEvent.setup();
    let called = false;
    server.use(
      http.post('/api/v1/platform/holiday-sets/:id/unpublish', () => {
        called = true;
        return HttpResponse.json({});
      }),
    );
    renderDetail();

    await screen.findByRole('heading', { name: 'Bangladesh 2026', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Unpublish' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(called).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Unpublish' }));

    await waitFor(() => expect(called).toBe(true));
  });

  it('shows a load error when the set fails to fetch', async () => {
    server.use(
      http.get('/api/v1/platform/holiday-sets/:id', () => HttpResponse.json({}, { status: 500 })),
    );

    renderDetail();

    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('blocks leaving with unsaved changes, and the "leave" action navigates away', async () => {
    const user = userEvent.setup();
    renderDetail();

    await screen.findByRole('heading', { name: 'Bangladesh 2026', level: 1 });
    const nameInput = screen.getByDisplayValue('International Mother Language Day');
    await user.type(nameInput, ' (edited)');

    // There is no back link any more; leave through the console's own nav.
    const leave = () => user.click(screen.getAllByRole('link', { name: 'Schools' })[0]!);
    await leave();

    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await leave();
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Leave' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
});
