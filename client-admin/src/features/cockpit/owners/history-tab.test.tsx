import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { HistoryTab } from './history-tab';

const row = (id: string, label: string) => ({
  id,
  action: 'PLATFORM_LOGIN',
  actorName: 'Owner One',
  at: '2029-12-31T00:00:00.000Z',
  label,
});

afterEach(async () => {
  await cleanupTestState();
});

describe('HistoryTab', () => {
  it('pages with Load more and shows the visible total', async () => {
    const cursors: (string | null)[] = [];
    server.use(
      http.get('*/platform/owners/history', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        cursors.push(cursor);
        return HttpResponse.json(
          cursor
            ? { data: [row('h2', 'Second entry')], nextCursor: null }
            : { data: [row('h1', 'First entry')], nextCursor: 'abc' },
        );
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<HistoryTab />, { locale: 'en' });
    await screen.findByText('First entry');
    expect(screen.getByText('1 entries shown')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Second entry');
    expect(screen.getByText('2 entries shown')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull());
    expect(cursors).toEqual([null, 'abc']);
  });

  it('empty state', async () => {
    server.use(
      http.get('*/platform/owners/history', () =>
        HttpResponse.json({ data: [], nextCursor: null }),
      ),
    );
    renderWithProviders(<HistoryTab />, { locale: 'en' });
    await screen.findByText('Nothing here yet.');
  });

  it('error state', async () => {
    server.use(
      http.get('*/platform/owners/history', () => new HttpResponse(null, { status: 500 })),
    );
    renderWithProviders(<HistoryTab />, { locale: 'en' });
    await screen.findByText('Could not load the history.');
  });
});
