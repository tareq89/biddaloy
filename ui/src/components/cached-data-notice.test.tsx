import { act, screen } from '@testing-library/react';
import type * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { clearFreshness, recordFreshness } from '../api/freshness';
import { mockOnlineStatus } from '../test/connectivity';
import { renderWithProviders } from '../test/render-with-providers';

import { CachedDataNotice } from './cached-data-notice';

const KEY = ['students', 'list', { page: 1 }];

/** Renders with the locale forced to English and waits for the language
 * bundle, since `DEFAULT_LOCALE` here is Bengali. */
async function renderInEnglish(ui: React.ReactElement): Promise<void> {
  const { localeReady } = renderWithProviders(ui, { locale: 'en' });
  // The language change re-renders the tree, so it is a state update the
  // test causes and therefore has to own.
  await act(async () => {
    await localeReady;
  });
}

afterEach(() => {
  // Wrapped: `clearFreshness` notifies every `useQueryFreshness`
  // subscriber, and a component rendered by this test may still be
  // mounted when this hook runs (Testing Library's own cleanup is a
  // separate `afterEach`). Without `act` that shows up as a warning, not
  // a failure — the kind of noise that trains people to ignore warnings.
  act(() => {
    clearFreshness();
  });
});

describe('CachedDataNotice', () => {
  it('renders nothing before the query has resolved', () => {
    const { container } = renderWithProviders(<CachedDataNotice queryKey={KEY} />);

    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for fresh network data', () => {
    recordFreshness(KEY, { fetchedAt: Date.now(), source: 'network' });

    const { container } = renderWithProviders(<CachedDataNotice queryKey={KEY} />);

    // No "you are up to date" badge: a banner that is always there is a
    // banner nobody reads by the time it matters.
    expect(container.innerHTML).toBe('');
  });

  it('labels service-worker-replayed data with its age', async () => {
    recordFreshness(KEY, { fetchedAt: Date.now() - 5 * 60_000, source: 'sw-cache' });

    // Locale pinned explicitly: this app's `DEFAULT_LOCALE` is `bn`, so a
    // test asserting English copy has to ask for English rather than
    // assume it.
    await renderInEnglish(<CachedDataNotice queryKey={KEY} />);

    expect(screen.getByRole('status').textContent).toContain(
      'Showing saved data from 5 minutes ago',
    );
  });

  it('labels Dexie-served data too, and reports hours rather than minutes', async () => {
    recordFreshness(KEY, { fetchedAt: Date.now() - 23 * 60 * 60_000, source: 'dexie' });

    await renderInEnglish(<CachedDataNotice queryKey={KEY} />);

    expect(screen.getByRole('status').textContent).toContain('23 hours ago');
  });

  it('adds the offline explanation only while the browser is offline', async () => {
    recordFreshness(KEY, { fetchedAt: Date.now() - 60_000, source: 'dexie' });
    mockOnlineStatus(false);

    await renderInEnglish(<CachedDataNotice queryKey={KEY} />);

    expect(screen.getByRole('status').textContent).toMatch(/You're offline/);
  });

  it('omits the offline explanation when the connection is up', async () => {
    recordFreshness(KEY, { fetchedAt: Date.now() - 60_000, source: 'dexie' });
    mockOnlineStatus(true);

    await renderInEnglish(<CachedDataNotice queryKey={KEY} />);

    expect(screen.getByRole('status').textContent).not.toMatch(/offline/);
  });

  it('reports nothing for a query key that differs by one filter', () => {
    recordFreshness(KEY, { fetchedAt: Date.now() - 60_000, source: 'dexie' });

    const { container } = renderWithProviders(
      <CachedDataNotice queryKey={['students', 'list', { page: 2 }]} />,
    );

    // Silence rather than the wrong age: a notice describing a different
    // query's data would be worse than none.
    expect(container.innerHTML).toBe('');
  });

  it('announces politely rather than interrupting — stale is important, not urgent', () => {
    recordFreshness(KEY, { fetchedAt: Date.now() - 60_000, source: 'dexie' });

    renderWithProviders(<CachedDataNotice queryKey={KEY} />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).not.toBeNull();
  });

  it('renders the age in Bengali numerals under the bn locale', async () => {
    recordFreshness(KEY, { fetchedAt: Date.now() - 5 * 60_000, source: 'dexie' });

    const { localeReady } = renderWithProviders(<CachedDataNotice queryKey={KEY} />, {
      locale: 'bn',
    });
    await act(async () => {
      await localeReady;
    });

    // `Intl.RelativeTimeFormat` is what makes this free — a hand-rolled
    // "N minutes ago" template would print Latin digits here.
    expect(screen.getByRole('status').textContent).toContain('৫');
  });
});
