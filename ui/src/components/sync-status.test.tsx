/**
 * [8.12.5]. Mostly prop-driven against the presentational `SyncStatus`:
 * the queue's real state lives behind Dexie *and* an active tenant, which
 * is a lot of machinery to stand up for assertions about what a chip
 * says. The connected `SyncStatusIndicator` gets its own smoke coverage
 * at the bottom, against a mocked engine module.
 *
 * The load-bearing test in here is `readFailed`: "you have nothing
 * unsynced" and "I can't tell whether you have anything unsynced" must
 * not render the same, because a user reads one of them and closes the
 * tab.
 */
import { act, screen } from '@testing-library/react';
import type * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QueueSnapshot } from '../api/mutation-queue';
import type { QueuedMutationRow } from '../api/offline-db';
import { i18n } from '../i18n';
import { renderWithProviders } from '../test/render-with-providers';

import { SyncStatus, SyncStatusIndicator } from './sync-status';
import { Toaster } from './toast';

const { mockSnapshot } = vi.hoisted((): { mockSnapshot: { current: QueueSnapshot } } => ({
  mockSnapshot: {
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
}));

vi.mock('../api/mutation-queue', () => ({
  getQueueSnapshot: () => mockSnapshot.current,
  subscribeQueueChanges: () => () => undefined,
  replayQueue: vi.fn(() => Promise.resolve()),
  retryMutation: vi.fn(() => Promise.resolve()),
  discardMutation: vi.fn(() => Promise.resolve()),
}));

const { replayQueue, retryMutation, discardMutation } = await import('../api/mutation-queue');

function snapshot(overrides: Partial<QueueSnapshot> = {}): QueueSnapshot {
  const rows = overrides.rows ?? [];
  return {
    tenantId: 'school-1',
    total: rows.length,
    pending: rows.filter((row) => row.status === 'pending').length,
    conflict: rows.filter((row) => row.status === 'conflict').length,
    dead: rows.filter((row) => row.status === 'dead').length,
    rows,
    readFailed: false,
    ...overrides,
  };
}

function row(seq: number, overrides: Partial<QueuedMutationRow> = {}): QueuedMutationRow {
  return {
    seq,
    tenantId: 'school-1',
    entity: 'attendance',
    method: 'post',
    path: '/attendance',
    body: {},
    enqueuedAt: Date.now() - 5 * 60_000,
    attempts: 0,
    status: 'pending',
    ...overrides,
  };
}

/** Renders in English and settles the language change, the way
 * `cached-data-notice.test.tsx` does — `DEFAULT_LOCALE` here is Bengali. */
async function renderInEnglish(ui: React.ReactElement) {
  const result = renderWithProviders(ui, { locale: 'en', tenantId: 'school-1' });
  await act(async () => {
    await result.localeReady;
  });
  return result;
}

const noop = () => undefined;

function props(overrides: Partial<React.ComponentProps<typeof SyncStatus>> = {}) {
  return {
    snapshot: snapshot(),
    online: true,
    onSendNow: noop,
    onRetryRow: noop,
    onDiscardRow: noop,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('SyncStatus chip states', () => {
  it('renders no chip, and no live region, when online, empty and readable', async () => {
    await renderInEnglish(<SyncStatus {...props()} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says the queue is unreadable rather than showing a reassuring zero', async () => {
    // Same counts as the all-clear state above — only `readFailed`
    // differs, and it has to be the difference between "nothing to send"
    // and "I don't know".
    await renderInEnglish(<SyncStatus {...props({ snapshot: snapshot({ readFailed: true }) })} />);

    const chip = screen.getByRole('button');
    expect(chip.textContent).toMatch(/can't check for unsent changes/i);
    expect(chip.textContent).not.toMatch(/waiting to send/i);
  });

  it('keeps saying the queue is unreadable even while offline with rows', async () => {
    await renderInEnglish(
      <SyncStatus
        {...props({
          online: false,
          snapshot: snapshot({ rows: [row(1)], readFailed: true }),
        })}
      />,
    );

    expect(screen.getByRole('button').textContent).toMatch(/can't check for unsent changes/i);
  });

  it('shows offline with no count when nothing is queued', async () => {
    await renderInEnglish(<SyncStatus {...props({ online: false })} />);

    const chip = screen.getByRole('button');
    expect(chip.textContent).toMatch(/you're offline/i);
    expect(chip.textContent).not.toMatch(/waiting to send/i);
  });

  it('shows offline with the queued count', async () => {
    await renderInEnglish(
      <SyncStatus {...props({ online: false, snapshot: snapshot({ rows: [row(1), row(2)] }) })} />,
    );

    expect(screen.getByRole('button').textContent).toMatch(/you're offline — 2 changes waiting/i);
  });

  it('shows the pending count when online', async () => {
    await renderInEnglish(<SyncStatus {...props({ snapshot: snapshot({ rows: [row(1)] }) })} />);

    expect(screen.getByRole('button').textContent).toMatch(/1 change waiting to send/i);
  });

  it('escalates to "needs your attention" for a conflict, in words not colour', async () => {
    await renderInEnglish(
      <SyncStatus
        {...props({ snapshot: snapshot({ rows: [row(1, { status: 'conflict' }), row(2)] }) })}
      />,
    );

    expect(screen.getByRole('button').textContent).toMatch(/some changes need your attention/i);
  });
});

describe('SyncStatus panel', () => {
  it('explains head-of-line blocking and names what is stuck behind it', async () => {
    const { user } = await renderInEnglish(
      <SyncStatus
        {...props({
          snapshot: snapshot({
            rows: [row(1, { status: 'conflict' }), row(2), row(3)],
          }),
        })}
      />,
    );
    await user.click(screen.getByRole('button'));

    expect(screen.getByText(/sent in the order you made them/i)).toBeTruthy();
    expect(screen.getByText(/holding up 2 other changes/i)).toBeTruthy();
    expect(screen.getAllByText(/waiting for the item above/i)).toHaveLength(2);
  });

  it('renders the raw server message as secondary detail, not the headline', async () => {
    const { user } = await renderInEnglish(
      <SyncStatus
        {...props({
          snapshot: snapshot({
            rows: [
              row(1, {
                status: 'dead',
                lastError: { statusCode: 500, message: 'Request failed with status code 500' },
              }),
            ],
          }),
        })}
      />,
    );
    await user.click(screen.getByRole('button'));

    // The translated sentence is what the user is asked to understand.
    expect(screen.getByText(/couldn't be sent after several tries/i)).toBeTruthy();
    const raw = screen.getByText('Request failed with status code 500');
    expect(raw.className).toContain('text-xs');
  });

  it('shows a full-panel explanation and no list when the queue is unreadable', async () => {
    const { user } = await renderInEnglish(
      <SyncStatus {...props({ snapshot: snapshot({ readFailed: true }) })} />,
    );
    await user.click(screen.getByRole('button'));

    expect(screen.getByText(/can't read your pending changes right now/i)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('disables "Send now" offline and with nothing pending', async () => {
    const { user } = await renderInEnglish(
      <SyncStatus {...props({ online: false, snapshot: snapshot({ rows: [row(1)] }) })} />,
    );
    await user.click(screen.getByRole('button', { name: /you're offline/i }));

    expect(screen.getByRole('button', { name: /send now/i })).toHaveProperty('disabled', true);
  });

  it('enables "Send now" online with pending rows and calls back', async () => {
    const onSendNow = vi.fn();
    const { user } = await renderInEnglish(
      <SyncStatus {...props({ snapshot: snapshot({ rows: [row(1)] }), onSendNow })} />,
    );
    await user.click(screen.getByRole('button', { name: /waiting to send/i }));
    await user.click(screen.getByRole('button', { name: /send now/i }));

    expect(onSendNow).toHaveBeenCalledTimes(1);
  });

  it('retries a single row by seq', async () => {
    const onRetryRow = vi.fn();
    const { user } = await renderInEnglish(
      <SyncStatus
        {...props({ snapshot: snapshot({ rows: [row(7, { status: 'conflict' })] }), onRetryRow })}
      />,
    );
    await user.click(screen.getByRole('button', { name: /need your attention/i }));
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(onRetryRow).toHaveBeenCalledWith(7);
  });

  it('offers no retry/discard for a row that is merely waiting its turn', async () => {
    const { user } = await renderInEnglish(
      <SyncStatus {...props({ snapshot: snapshot({ rows: [row(1)] }) })} />,
    );
    await user.click(screen.getByRole('button', { name: /waiting to send/i }));

    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /discard this change/i })).toBeNull();
  });
});

describe('SyncStatus discard confirmation', () => {
  it('does not destroy the row until the dialog is confirmed', async () => {
    const onDiscardRow = vi.fn();
    const { user } = await renderInEnglish(
      <SyncStatus
        {...props({ snapshot: snapshot({ rows: [row(9, { status: 'dead' })] }), onDiscardRow })}
      />,
    );
    await user.click(screen.getByRole('button', { name: /need your attention/i }));
    await user.click(screen.getByRole('button', { name: /discard this change/i }));

    expect(screen.getByRole('dialog').textContent).toMatch(/discard this change\?/i);
    expect(onDiscardRow).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^keep it$/i }));
    expect(onDiscardRow).not.toHaveBeenCalled();
  });

  it('discards on confirm', async () => {
    const onDiscardRow = vi.fn();
    const { user } = await renderInEnglish(
      <SyncStatus
        {...props({ snapshot: snapshot({ rows: [row(9, { status: 'dead' })] }), onDiscardRow })}
      />,
    );
    await user.click(screen.getByRole('button', { name: /need your attention/i }));
    await user.click(screen.getByRole('button', { name: /discard this change/i }));
    await user.click(screen.getByRole('button', { name: /^discard$/i }));

    expect(onDiscardRow).toHaveBeenCalledWith(9);
  });
});

describe('SyncStatus live region', () => {
  it('announces politely, and says everything is saved when the queue empties', async () => {
    const { rerender } = await renderInEnglish(
      <SyncStatus {...props({ snapshot: snapshot({ rows: [row(1)] }) })} />,
    );

    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    // Nothing is announced for the state the user arrived in.
    expect(region.textContent).toBe('');

    rerender(<SyncStatus {...props({ snapshot: snapshot({ rows: [row(1), row(2)] }) })} />);
    expect(region.textContent).toMatch(/2 changes waiting to send/i);

    rerender(<SyncStatus {...props()} />);
    expect(region.textContent).toMatch(/all your changes are saved/i);
    // …and the chip itself is gone: the confirmation is a moment, not
    // permanent furniture.
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('SyncStatusIndicator', () => {
  beforeEach(() => {
    mockSnapshot.current = {
      tenantId: null,
      total: 0,
      pending: 0,
      conflict: 0,
      dead: 0,
      rows: [],
      readFailed: false,
    };
  });

  it('renders no chip before there is a tenant with queued work', async () => {
    await renderInEnglish(<SyncStatusIndicator />);

    expect(screen.queryByRole('button')).toBeNull();
    // Not even an empty live region: a page with its own `role="status"`
    // should not have to compete with a permanently mounted one.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('wires its buttons to the queue engine', async () => {
    mockSnapshot.current = snapshot({ rows: [row(4, { status: 'conflict' }), row(5)] });
    const { user } = await renderInEnglish(<SyncStatusIndicator />);

    await user.click(screen.getByRole('button', { name: /need your attention/i }));

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(retryMutation).toHaveBeenCalledWith(4);

    await user.click(screen.getByRole('button', { name: /discard this change/i }));
    await user.click(screen.getByRole('button', { name: /^discard$/i }));
    expect(discardMutation).toHaveBeenCalledWith(4);
  });

  it('sends now when the head of the queue can actually go', async () => {
    mockSnapshot.current = snapshot({ rows: [row(1), row(2)] });
    const { user } = await renderInEnglish(<SyncStatusIndicator />);

    await user.click(screen.getByRole('button', { name: /waiting to send/i }));
    await user.click(screen.getByRole('button', { name: /send now/i }));

    expect(replayQueue).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed queue action instead of dropping it', async () => {
    // `discardMutation` starts with a Dexie call, which rejects when a
    // logout lands mid-action. Dropped, the dialog closes as though it
    // worked and the row silently stays — the "we told you it stuck when
    // it did not" failure the engine documents as unacceptable.
    mockSnapshot.current = snapshot({ rows: [row(4, { status: 'conflict' })] });
    vi.mocked(discardMutation).mockRejectedValueOnce(new Error('DatabaseClosedError'));
    // `<Toaster />` has to be mounted for sonner to render anything —
    // same setup as `toast.test.tsx`.
    const { user } = await renderInEnglish(
      <>
        <SyncStatusIndicator />
        <Toaster />
      </>,
    );

    await user.click(screen.getByRole('button', { name: /need your attention/i }));
    await user.click(screen.getByRole('button', { name: /discard this change/i }));
    await user.click(screen.getByRole('button', { name: /^discard$/i }));

    expect(await screen.findByText(/could not update your pending changes/i)).toBeTruthy();
  });
});

describe('the indicator must not overstate or mis-state the queue', () => {
  it('disables "Send now" when a conflict is blocking the head of the queue', async () => {
    // Replay stops at the first non-pending row, so with a conflict at the
    // head this button would send nothing at all — a click with no count
    // change, no error and no feedback.
    const { user } = await renderInEnglish(
      <SyncStatus
        {...props({ snapshot: snapshot({ rows: [row(1, { status: 'conflict' }), row(2)] }) })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /need your attention/i }));

    expect(screen.getByRole('button', { name: /send now/i }).hasAttribute('disabled')).toBe(true);
  });

  it('counts only sendable rows as waiting, when offline', async () => {
    // A dead-lettered row is not "waiting to send" — it will never send
    // until a human decides something. Counting it promises delivery that
    // is not coming.
    await renderInEnglish(
      <SyncStatus
        {...props({
          online: false,
          snapshot: snapshot({ rows: [row(1), row(2, { status: 'dead' })] }),
        })}
      />,
    );

    expect(screen.getByRole('button', { name: /1 change waiting to send/i })).toBeTruthy();
  });
});

describe('the all-clear must mean something', () => {
  it('keeps the live region mounted across the drain, so the all-clear is spoken', async () => {
    // A live region announces changes to text it was already watching. If
    // the region unmounts with the chip and a fresh node arrives already
    // carrying the all-clear, assistive tech generally says nothing —
    // and this is the one message with no visible counterpart.
    const { rerender } = await renderInEnglish(
      <SyncStatus {...props({ snapshot: snapshot({ rows: [row(1)] }) })} />,
    );
    const before = screen.getByRole('status');

    rerender(<SyncStatus {...props()} />);

    const after = screen.getByRole('status');
    expect(after).toBe(before);
    expect(before.isConnected).toBe(true);
    expect(after.textContent).toMatch(/all your changes are saved/i);
  });

  it('says nothing when the user merely went offline and back with an empty queue', async () => {
    const { rerender } = await renderInEnglish(<SyncStatus {...props({ online: false })} />);

    rerender(<SyncStatus {...props()} />);

    // Nothing was ever queued, so there is nothing to confirm — and no
    // region at all, since the component never saw queue activity.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not claim work was saved when the user discarded it', async () => {
    const { rerender } = await renderInEnglish(
      <SyncStatus {...props({ snapshot: snapshot({ rows: [row(1, { status: 'conflict' })] }) })} />,
    );

    // The row is discarded, not sent.
    rerender(<SyncStatus {...props()} />);

    expect(screen.getByRole('status').textContent).not.toMatch(/saved/i);
  });

  it('does not announce merely because the language changed', async () => {
    const { rerender } = await renderInEnglish(
      <SyncStatus {...props({ snapshot: snapshot({ rows: [row(1)] }) })} />,
    );
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');

    // Same queue, different words. Nothing happened, so nothing is news.
    await i18n.changeLanguage('bn');
    rerender(<SyncStatus {...props({ snapshot: snapshot({ rows: [row(1)] }) })} />);

    expect(region.textContent).toBe('');
    await i18n.changeLanguage('en');
  });
});
