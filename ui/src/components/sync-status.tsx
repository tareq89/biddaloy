/**
 * [8.12.5] The visible half of the offline mutation queue: persistent
 * chrome that answers one question — "is my work saved, or is it still
 * sitting in this tab?"
 *
 * Two exports, deliberately split:
 *
 * - `SyncStatus` is presentational. Every state it can be in is a prop,
 *   so the stories and the bulk of the tests drive it directly. (This
 *   diverges from `cached-data-notice.stories.tsx`, which seeds the real
 *   module: queue state lives behind Dexie *and* an active tenant, which
 *   a synchronous story decorator cannot seed.)
 * - `SyncStatusIndicator` is the zero-prop connected version the apps
 *   mount in their top bar. It wires `useSyncQueue`/`useOnline` to the
 *   engine's `replayQueue`/`retryMutation`/`discardMutation`.
 *
 * Anti-furniture rule, same as `cached-data-notice.tsx`: when the user is
 * online, the queue is empty, and the queue is *readable*, the chip
 * renders nothing. There is no permanent "Saved" badge — a badge that is
 * always on screen stops being read before the day it matters. Positive
 * confirmation is delivered once, as a polite live-region announcement
 * ("All your changes are saved.") at the moment the count reaches zero.
 *
 * `readFailed` wins over every other state and never falls through to the
 * hidden one. "You have no unsynced changes" and "I cannot tell you
 * whether you have unsynced changes" must not look the same to someone
 * deciding whether it is safe to close the tab.
 *
 * Head-of-line blocking is explained, not worked around: replay stops at
 * the first row that is not `pending` (`api/mutation-queue.ts`), because
 * later rows commonly edit the same record. The panel says so, marks the
 * blocking row, and tells the rows behind it what they are waiting for —
 * which is what makes a "5 waiting to send" that never decreases
 * comprehensible.
 *
 * Composition only — `Popover`, `Dialog`, `Button` and the design
 * system's `text-muted-foreground`/`bg-muted`/`border-border`/
 * `bg-destructive` tokens. No new primitive, no bespoke colour, and every
 * state carries an icon *and* words, never colour alone.
 */
import { AlertTriangleIcon, CloudOffIcon, CloudUploadIcon } from 'lucide-react';
import * as React from 'react';

import {
  discardMutation,
  replayQueue,
  retryMutation,
  type QueueSnapshot,
} from '../api/mutation-queue';
import type { QueuedMutationRow } from '../api/offline-db';
import { useOnline } from '../hooks/use-online';
import { useSyncQueue } from '../hooks/use-sync-queue';
import { useLocale, useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';
import { formatRelativeAge } from '../utils/date';

import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from './popover';
import { toast } from './toast';

export interface SyncStatusProps {
  /** The queue as `api/mutation-queue.ts` reports it. */
  snapshot: QueueSnapshot;
  /** `useOnline()`'s answer, passed in so stories can force it. */
  online: boolean;
  /** "Send now" — the connected version calls `replayQueue()`. */
  onSendNow: () => void;
  /** Retry one row by `seq` — `retryMutation(seq)`. */
  onRetryRow: (seq: number) => void;
  /** Throw one row away by `seq` — `discardMutation(seq)`. Only ever
   * reached through the confirmation dialog. */
  onDiscardRow: (seq: number) => void;
  className?: string;
}

/** The five things the chip can say, plus `clear` (says nothing). Derived
 * in one place so the chip, the live region and the tests all agree on
 * what state the queue is in. */
type SyncState =
  'readFailed' | 'offline' | 'offlineWithCount' | 'needsAttention' | 'pending' | 'clear';

function deriveState(snapshot: QueueSnapshot, online: boolean): SyncState {
  // First, and without an `else` anywhere below it: an unreadable queue
  // must never be rendered as a reassuring zero.
  if (snapshot.readFailed) return 'readFailed';
  if (!online) return snapshot.pending > 0 ? 'offlineWithCount' : 'offline';
  if (snapshot.conflict + snapshot.dead > 0) return 'needsAttention';
  if (snapshot.pending > 0) return 'pending';
  return 'clear';
}

/** How often "Added 3 minutes ago" is recomputed while the panel is on
 * screen. Same reasoning (and resolution) as `cached-data-notice.tsx`'s
 * tick: without it the one number these rows exist to communicate would
 * still say "1 minute ago" an hour later. */
const AGE_TICK_MS = 60_000;

export function SyncStatus({
  snapshot,
  online,
  onSendNow,
  onRetryRow,
  onDiscardRow,
  className,
}: SyncStatusProps) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const state = deriveState(snapshot, online);
  const [discardSeq, setDiscardSeq] = React.useState<number | null>(null);

  const [, forceTick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (snapshot.total === 0) return;
    const timer = setInterval(forceTick, AGE_TICK_MS);
    return () => clearInterval(timer);
  }, [snapshot.total]);

  const chipLabel = (() => {
    switch (state) {
      case 'readFailed':
        return t('sync.readFailed');
      case 'offline':
        return t('sync.offline');
      case 'offlineWithCount':
        // `pending`, not `total`: a conflicted or dead-lettered row is not
        // "waiting to send" — it will never send until a human decides
        // something. Counting it here promises delivery that is not
        // coming, and the user only finds out on reconnect.
        return t('sync.offlineWithCount', { count: snapshot.pending });
      case 'needsAttention':
        return t('sync.needsAttention');
      case 'pending':
        return t('sync.pendingCount', { count: snapshot.pending });
      case 'clear':
        return null;
    }
  })();

  // Latched, never unset for the life of the component — see the live
  // region's own comment for why removing the node loses the all-clear.
  const [liveRegionMounted, setLiveRegionMounted] = React.useState(false);
  if (!liveRegionMounted && (snapshot.total > 0 || snapshot.readFailed)) {
    setLiveRegionMounted(true);
  }

  // Read through a ref by the announcement effect below, so that
  // re-translating the label cannot by itself trigger an announcement.
  const chipLabelRef = React.useRef<string | null>(null);
  chipLabelRef.current = chipLabel;

  // Announced politely on *transitions* only, and keyed off the queue's
  // own numbers rather than the rendered string. Watching the translated
  // label meant a language switch — which changes every word while
  // nothing about the queue moved — announced as though work had
  // happened. Counts are in the signature because "1 waiting" becoming
  // "2 waiting" is real news even though the state is `pending` both
  // times; the translated text is not, because that is the part a
  // language switch changes.
  const [announcement, setAnnouncement] = React.useState('');
  const signature = `${state}:${snapshot.pending}:${snapshot.conflict}:${snapshot.dead}`;
  const previousSignature = React.useRef<string | undefined>(undefined);
  // Latches once the user actually has work in flight. Both the all-clear
  // and the live region's presence depend on it, because "saved" is only
  // meaningful to someone who had something to save.
  const hadPendingWork = React.useRef(false);
  if (snapshot.pending > 0) hadPendingWork.current = true;

  React.useEffect(() => {
    const previous = previousSignature.current;
    previousSignature.current = signature;
    // First render: describing a state the user has not moved into yet is
    // noise, not news.
    if (previous === undefined || previous === signature) return;

    if (state !== 'clear') {
      setAnnouncement(chipLabelRef.current ?? '');
      return;
    }

    // Reaching `clear` is not automatically good news. Going offline and
    // back with an empty queue lands here, and so does discarding the last
    // conflicted row — telling someone their changes are saved when they
    // just threw one away is worse than silence.
    if (!hadPendingWork.current) return;
    hadPendingWork.current = false;
    setAnnouncement(t('sync.allSaved'));
    // `signature` is intentionally the only queue-derived dependency: the
    // label is read through a ref so re-translating cannot re-announce.
  }, [signature, state, t]);

  const rows = snapshot.rows;
  // Replay walks ascending `seq` and stops at the first row that is not
  // `pending`, so that row — and only that row — is what everything
  // behind it is waiting on.
  const blockedIndex = rows.findIndex((row) => row.status !== 'pending');
  const blockedCount = blockedIndex === -1 ? 0 : rows.length - blockedIndex - 1;
  const discardRow = rows.find((row) => row.seq === discardSeq);

  return (
    <>
      {/* `status`, not `alert`: a sync transition is important, not urgent
          enough to interrupt the sentence being read. Same call
          `cached-data-notice.tsx` makes.

          Mounted from the first sign of queue activity and *kept* mounted
          for the rest of the session, rather than for the whole life of
          the app or only while a chip shows. Both extremes are wrong:

          - Always mounted puts a second `role="status"` on every page,
            which is a screen-reader landmark for nothing and a genuine
            ambiguity for pages with their own status region
            (`/fees/generate`, `/payments/record`).
          - Mounted only while a chip shows breaks the one announcement
            that has no visible counterpart. When the last row drains, the
            chip and the region disappear in the same render, and the
            all-clear text then arrives in a *newly inserted* node — which
            assistive tech generally does not speak, because a live region
            announces changes to text it was already watching.

          So: latch on activity, keep the node, change its text. */}
      {liveRegionMounted && (
        <span role="status" aria-live="polite" className="sr-only">
          {announcement}
        </span>
      )}
      {chipLabel !== null && (
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className={cn('gap-2', className)}>
              {state === 'readFailed' || state === 'needsAttention' ? (
                <AlertTriangleIcon aria-hidden="true" className="text-destructive" />
              ) : state === 'offline' || state === 'offlineWithCount' ? (
                <CloudOffIcon aria-hidden="true" />
              ) : (
                <CloudUploadIcon aria-hidden="true" />
              )}
              <span>{chipLabel}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" aria-label={t('sync.panelTitle')} className="w-80">
            <PopoverHeader className="flex-row items-center justify-between">
              <PopoverTitle>{t('sync.panelTitle')}</PopoverTitle>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                // Not just "are there pending rows": replay walks
                // ascending `seq` and stops at the first row that is not
                // `pending`, so a conflict at the head means this button
                // would send nothing at all. Enabled, it was a click that
                // produced no count change, no error and no feedback.
                disabled={!online || rows[0]?.status !== 'pending'}
                onClick={onSendNow}
              >
                {t('sync.actions.sendNow')}
              </Button>
            </PopoverHeader>
            {snapshot.readFailed ? (
              <p className="p-2 text-sm text-muted-foreground">{t('sync.readFailedDetail')}</p>
            ) : (
              <>
                {blockedCount > 0 && (
                  <p className="rounded-md border border-border bg-muted p-2 text-sm text-muted-foreground">
                    {t('sync.blockedExplanation')}
                  </p>
                )}
                <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                  {rows.map((row, index) => (
                    <SyncRow
                      key={row.seq}
                      row={row}
                      locale={locale}
                      blocking={index === blockedIndex}
                      blockedCount={blockedCount}
                      waiting={blockedIndex !== -1 && index > blockedIndex}
                      onRetry={onRetryRow}
                      onDiscard={setDiscardSeq}
                    />
                  ))}
                </ul>
              </>
            )}
          </PopoverContent>
        </Popover>
      )}
      {/* The one path that destroys queued work on purpose, so it asks
          first. */}
      <Dialog
        open={discardRow !== undefined}
        onOpenChange={(open) => {
          if (!open) setDiscardSeq(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sync.discardConfirm.title')}</DialogTitle>
            <DialogDescription>{t('sync.discardConfirm.body')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDiscardSeq(null)}>
              {t('sync.discardConfirm.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (discardRow?.seq !== undefined) onDiscardRow(discardRow.seq);
                setDiscardSeq(null);
              }}
            >
              {t('sync.discardConfirm.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface SyncRowProps {
  row: QueuedMutationRow;
  locale: string;
  blocking: boolean;
  blockedCount: number;
  waiting: boolean;
  onRetry: (seq: number) => void;
  onDiscard: (seq: number) => void;
}

function SyncRow({
  row,
  locale,
  blocking,
  blockedCount,
  waiting,
  onRetry,
  onDiscard,
}: SyncRowProps) {
  const { t } = useTranslation();
  const seq = row.seq;
  return (
    <li
      className={cn(
        'flex flex-col gap-0.5 rounded-md p-2 text-sm',
        // Marked visually *and* textually — the "Holding up N changes"
        // line below carries the same meaning for anyone who cannot see
        // the border.
        blocking && 'border border-destructive/40 bg-destructive/10',
      )}
    >
      <span className="font-medium">{t(`sync.entity.${row.entity}`)}</span>
      <span className="text-xs text-muted-foreground">
        {t('sync.addedAge', { age: formatRelativeAge(row.enqueuedAt, locale) })}
      </span>
      <span>{t(`sync.status.${row.status}`)}</span>
      {blocking && blockedCount > 0 && <span>{t('sync.holdingUp', { count: blockedCount })}</span>}
      {waiting && <span className="text-muted-foreground">{t('sync.waitingForAbove')}</span>}
      {/* Raw axios/server text, in English whatever the active locale is —
          so it is secondary detail for someone reporting the problem, never
          the sentence the user is asked to understand. */}
      {row.lastError && (
        <span className="text-xs text-muted-foreground">{row.lastError.message}</span>
      )}
      {row.status !== 'pending' && seq !== undefined && (
        <span className="flex gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => onRetry(seq)}>
            {t('sync.actions.tryAgain')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onDiscard(seq)}>
            {t('sync.actions.discard')}
          </Button>
        </span>
      )}
    </li>
  );
}

/**
 * The connected indicator the apps mount in their top bar. Zero props:
 * everything it needs is module state, the same way `NotificationBell`
 * reads `notification-state.ts`.
 *
 * `getQueueSnapshot()` returns the stable empty snapshot when there is no
 * active tenant, so this renders nothing at all before login — including
 * in route tests, which is why mounting it needs no test fixture changes.
 */
export function SyncStatusIndicator({ className }: { className?: string }) {
  const snapshot = useSyncQueue();
  const online = useOnline();
  const { t } = useTranslation();

  /**
   * Every engine call is awaited-then-caught rather than `void`-ed.
   * `discardMutation` and `retryMutation` both start with a Dexie
   * operation, which rejects on a `DatabaseClosedError` (a logout landing
   * mid-action) or a quota error. Dropped, the confirmation dialog closes
   * as though it worked, the row silently stays in the list, and the only
   * trace is an `unhandledrejection` in Sentry — which is precisely the
   * "told the user it stuck when it did not" failure the queue engine
   * documents as unacceptable.
   */
  const runQueueAction = (action: () => Promise<unknown>) => {
    void action().catch(() => {
      toast.error(t('sync.actionFailed'));
    });
  };

  return (
    <SyncStatus
      snapshot={snapshot}
      online={online}
      onSendNow={() => runQueueAction(replayQueue)}
      onRetryRow={(seq) => runQueueAction(() => retryMutation(seq))}
      onDiscardRow={(seq) => runQueueAction(() => discardMutation(seq))}
      {...(className === undefined ? {} : { className })}
    />
  );
}
