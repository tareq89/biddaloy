/**
 * [8.12.5]. These drive the **presentational** `SyncStatus`, not the
 * connected `SyncStatusIndicator`: the connected one reads Dexie through
 * an active tenant, which a synchronous story decorator cannot seed. This
 * is a deliberate divergence from `cached-data-notice.stories.tsx`'s
 * seed-the-real-module pattern — the state space here is worth having as
 * props.
 *
 * Open the panel on any story to see the row list; the blocking story
 * below opens it by default because the sentence it renders is the whole
 * point of that state.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';
import type { QueueSnapshot } from '../api/mutation-queue';
import type { QueuedMutationRow } from '../api/offline-db';

import { SyncStatus } from './sync-status';

function row(seq: number, overrides: Partial<QueuedMutationRow> = {}): QueuedMutationRow {
  return {
    seq,
    tenantId: 'school-1',
    entity: 'attendance',
    method: 'post',
    path: '/attendance',
    body: {},
    enqueuedAt: Date.now() - seq * 4 * 60_000,
    attempts: 0,
    status: 'pending',
    ...overrides,
  };
}

function snapshot(rows: QueuedMutationRow[], readFailed = false): QueueSnapshot {
  return {
    tenantId: 'school-1',
    total: rows.length,
    pending: rows.filter((r) => r.status === 'pending').length,
    conflict: rows.filter((r) => r.status === 'conflict').length,
    dead: rows.filter((r) => r.status === 'dead').length,
    rows,
    readFailed,
  };
}

const meta: Meta<typeof SyncStatus> = {
  title: 'Components/SyncStatus',
  component: SyncStatus,
  tags: ['autodocs'],
  args: {
    snapshot: snapshot([]),
    online: true,
    onSendNow: () => undefined,
    onRetryRow: () => undefined,
    onDiscardRow: () => undefined,
  },
};

export default meta;
type Story = StoryObj<typeof SyncStatus>;

/**
 * Online, queue empty, queue readable — **nothing renders at all**, so
 * this story is deliberately blank (the same call `CachedDataNotice`'s
 * `FreshRendersNothing` makes). There is no permanent "Saved" chip.
 *
 * Not even the live region is here: it mounts on the first sign of queue
 * activity and stays for the rest of the session, so a component that has
 * never seen a queued row renders nothing whatsoever. The all-clear
 * announcement therefore belongs to a session that had work, not to this
 * cold-start state.
 */
export const AllSavedRendersNothing: Story = {};

/** No connection, nothing waiting — the user is told about the
 * connection, not scared about their work. */
export const OfflineNoChanges: Story = {
  args: { online: false },
};

/** The state this feature exists for: the connection is gone and work is
 * sitting in this tab. The count is the answer to "can I close this?" */
export const OfflineWithPending: Story = {
  args: { online: false, snapshot: snapshot([row(1), row(2), row(3)]) },
};

/** Back online, replay in progress. The chip disappears on its own once
 * the last row lands. */
export const OnlinePending: Story = {
  args: { snapshot: snapshot([row(1), row(2)]) },
};

/**
 * Head-of-line blocking made legible. Replay stops at the first
 * non-`pending` row, so a count that never decreases would otherwise look
 * like a bug — the panel says why, marks the row that is stuck, and tells
 * the rows behind it what they are waiting for.
 */
export const ConflictBlockingTheQueue: Story = {
  args: {
    snapshot: snapshot([
      row(1, {
        status: 'conflict',
        attempts: 1,
        lastError: { statusCode: 409, message: 'Request failed with status code 409' },
      }),
      row(2),
      row(3),
    ]),
  },
};

/** Failed the finite retry budget. Kept, never silently dropped — retry
 * and discard are both one click away. */
export const DeadLetter: Story = {
  args: {
    snapshot: snapshot([
      row(1, {
        status: 'dead',
        attempts: 5,
        lastError: { statusCode: 500, message: 'Request failed with status code 500' },
      }),
    ]),
  },
};

/**
 * The queue itself could not be read. This must never collapse into the
 * blank all-clear story above: "you have nothing unsent" and "I can't
 * tell whether you have anything unsent" are different answers to the
 * question "is it safe to close this tab?"
 */
export const ReadFailed: Story = {
  args: { snapshot: snapshot([], true) },
};

export const RightToLeft: Story = {
  args: { online: false, snapshot: snapshot([row(1), row(2)]) },
  decorators: [rtlDecorator],
};
