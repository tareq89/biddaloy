/**
 * [3329 / 4292]. Offline, slow (>4 s), queued count, fail-open and the D11
 * never-say check. The connected banner is driven for real (navigator.onLine,
 * a pending query); only the offline queue count is mocked.
 */
import { act, screen } from '@testing-library/react';
import type * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockOnlineStatus } from '../test/connectivity';
import { createTestQueryClient, renderWithProviders } from '../test/render-with-providers';

import { ConnectionBanner, ConnectionBannerView, SLOW_AFTER_MS } from './connection-banner';

const { queue } = vi.hoisted(() => ({ queue: { pending: 0 } }));
vi.mock('../hooks/use-sync-queue', () => ({ useSyncQueue: () => queue }));

const NEVER = /network error|latency|timeout|token|\b401\b|\b403\b|\bnull\b|forbidden/i;

async function render(ui: React.ReactElement, locale: 'en' | 'bn' = 'en') {
  const client = createTestQueryClient();
  const result = renderWithProviders(ui, { locale, queryClient: client });
  await act(async () => {
    await result.localeReady;
  });
  return { ...result, client };
}

beforeEach(() => {
  queue.pending = 0;
  mockOnlineStatus(true);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ConnectionBanner', () => {
  it('shows nothing when online and nothing is slow', async () => {
    const { container } = await render(<ConnectionBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('offline shows the message and a Retry that refetches active queries', async () => {
    mockOnlineStatus(false);
    const { client, user } = await render(<ConnectionBanner />);
    const refetch = vi.spyOn(client, 'refetchQueries').mockResolvedValue();

    expect(screen.getByRole('status').textContent).toContain('No internet');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledWith({ type: 'active' });
  });

  it('hides again when the connection is back', async () => {
    mockOnlineStatus(false);
    await render(<ConnectionBanner />);
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => mockOnlineStatus(true));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the queued write count', async () => {
    mockOnlineStatus(false);
    queue.pending = 3;
    await render(<ConnectionBanner />);
    expect(screen.getByRole('status').textContent).toContain('3');
  });

  it('a request pending over 4 s shows slow; under 4 s does not; hides when it ends', async () => {
    vi.useFakeTimers();
    const { client } = await render(<ConnectionBanner />);
    let finish: () => void = () => undefined;
    act(() => {
      void client.fetchQuery({
        queryKey: ['slow'],
        queryFn: () => new Promise<null>((resolve) => (finish = () => resolve(null))),
      });
    });

    // Let the query client's batched notification reach useIsFetching first.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOW_AFTER_MS - 100);
    });
    expect(screen.queryByRole('status')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByRole('status').textContent).toContain('Slow internet');
    expect(screen.queryByRole('button')).toBeNull();

    await act(async () => {
      finish();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('ConnectionBannerView strings', () => {
  it.each(['en', 'bn'] as const)('%s uses no never-say term in any state', async (locale) => {
    for (const props of [
      { online: false, slow: false, queued: 2 },
      { online: true, slow: true, queued: 0 },
    ]) {
      const { container, unmount } = await render(
        <ConnectionBannerView {...props} onRetry={() => undefined} />,
        locale,
      );
      const text = container.textContent ?? '';
      expect(text).not.toBe('');
      expect(text).not.toMatch(NEVER);
      unmount();
    }
  });
});
