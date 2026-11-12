import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { HistoryTab } from './history-tab';

const row = (id: string, label: string, action = 'UNKNOWN_CODE') => ({
  id,
  action,
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

  it('translates a known action code and falls back to the label for an unknown one', async () => {
    server.use(
      http.get('*/platform/owners/history', () =>
        HttpResponse.json({
          data: [row('h1', 'Server phrase', 'PLATFORM_OWNER_LOCKED'), row('h2', 'Fallback phrase')],
          nextCursor: null,
        }),
      ),
    );
    renderWithProviders(<HistoryTab />, { locale: 'bn' });
    await screen.findByText('মালিককে আটকে দেওয়া হয়েছে');
    expect(screen.queryByText('Server phrase')).toBeNull();
    expect(screen.getByText('Fallback phrase')).toBeTruthy();
  });

  it('keeps loaded rows when a later page fails, and retries the first-page failure', async () => {
    let fail = false;
    server.use(
      http.get('*/platform/owners/history', ({ request }) =>
        new URL(request.url).searchParams.get('cursor') && fail
          ? new HttpResponse(null, { status: 400 })
          : HttpResponse.json({ data: [row('h1', 'First entry')], nextCursor: 'abc' }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<HistoryTab />, { locale: 'en' });
    await screen.findByText('First entry');
    fail = true;
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Could not load more.');
    expect(screen.getByText('First entry')).toBeTruthy();
  });

  it('first-page failure offers Retry', async () => {
    let ok = false;
    server.use(
      http.get('*/platform/owners/history', () =>
        ok
          ? HttpResponse.json({ data: [row('h1', 'First entry')], nextCursor: null })
          : new HttpResponse(null, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<HistoryTab />, { locale: 'en' });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    ok = true;
    await user.click(retry);
    await screen.findByText('First entry');
  });
});
