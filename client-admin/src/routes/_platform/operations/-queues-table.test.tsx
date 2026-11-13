import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QueuesTable, sortFailedFirst } from './-queues-table';

const Q = [
  { name: 'b', available: true, waiting: 1, failed: 0 },
  { name: 'a', available: true, waiting: 1, failed: 0 },
  { name: 'c', available: true, waiting: 2, failed: 5 },
  { name: 'd', available: false },
];
const base = { loading: false, isFetching: false, onRetry: vi.fn() };

afterEach(async () => {
  await cleanupTestState();
});

describe('QueuesTable', () => {
  it('sorts failed first, then by name, without mutating', () => {
    const copy = [...Q];
    expect(sortFailedFirst(Q).map((q) => q.name)).toEqual(['c', 'a', 'b', 'd']);
    expect(Q).toEqual(copy);
  });

  it('shows Retry failed only on a queue with failures and calls back with its name', async () => {
    const onRetry = vi.fn();
    const { localeReady } = renderWithProviders(
      <QueuesTable {...base} queues={Q} onRetry={onRetry} />,
      { locale: 'en' },
    );
    await localeReady;
    expect(await screen.findAllByRole('button', { name: /Retry failed jobs of/ })).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry failed jobs of c' }));
    expect(onRetry).toHaveBeenCalledWith('c');
  });

  it('marks an unavailable queue', async () => {
    const { localeReady } = renderWithProviders(<QueuesTable {...base} queues={Q} />, {
      locale: 'en',
    });
    await localeReady;
    expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
  });

  it('shows the empty and error states', async () => {
    const { unmount, localeReady: ready } = renderWithProviders(
      <QueuesTable {...base} queues={[]} />,
      { locale: 'en' },
    );
    await ready;
    expect(screen.getByText('No queues')).toBeTruthy();
    unmount();
    const { localeReady } = renderWithProviders(
      <QueuesTable {...base} queues={[]} error="Could not load operations." />,
      {
        locale: 'en',
      },
    );
    await localeReady;
    expect(screen.getByText('Could not load operations.')).toBeTruthy();
  });
});
