/**
 * [8.12.5]. The hook is three lines, and all three of them are about
 * *subscribing* — so the only thing worth asserting is that a queue change
 * re-renders the component reading it, and that unmounting lets go of the
 * listener. The engine module is mocked so the test drives the store
 * directly instead of standing up Dexie and a tenant.
 */
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QueueSnapshot } from '../api/mutation-queue';

import { useSyncQueue } from './use-sync-queue';

// `vi.hoisted`: the mock factory runs during the import phase, before a
// plain module-scope `const` would have initialised.
const { listeners, store } = vi.hoisted(
  (): { listeners: Set<() => void>; store: { current: QueueSnapshot } } => ({
    listeners: new Set<() => void>(),
    store: {
      current: {
        tenantId: null,
        total: 0,
        pending: 0,
        conflict: 0,
        dead: 0,
        rows: [],
        readFailed: false,
      },
    },
  }),
);

vi.mock('../api/mutation-queue', () => ({
  getQueueSnapshot: () => store.current,
  subscribeQueueChanges: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
}));

function emptySnapshot(): QueueSnapshot {
  return {
    tenantId: null,
    total: 0,
    pending: 0,
    conflict: 0,
    dead: 0,
    rows: [],
    readFailed: false,
  };
}

function Probe() {
  const snapshot = useSyncQueue();
  return <span data-testid="total">{snapshot.total}</span>;
}

beforeEach(() => {
  listeners.clear();
  store.current = emptySnapshot();
});

describe('useSyncQueue', () => {
  it('re-renders when the queue notifies a change', () => {
    render(<Probe />);
    expect(screen.getByTestId('total').textContent).toBe('0');

    act(() => {
      store.current = { ...emptySnapshot(), tenantId: 'school-1', total: 3, pending: 3 };
      listeners.forEach((listener) => listener());
    });

    expect(screen.getByTestId('total').textContent).toBe('3');
  });

  it('unsubscribes on unmount, so a background refresh cannot update a dead tree', () => {
    const { unmount } = render(<Probe />);
    expect(listeners.size).toBe(1);

    unmount();
    expect(listeners.size).toBe(0);
  });
});
