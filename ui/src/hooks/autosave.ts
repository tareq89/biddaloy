/**
 * [19.7.1] D13/D19 — one autosave engine shared by `marks-grid.tsx` and
 * `marks-stepper.tsx`, so the two layouts can never drift in save-state
 * semantics. A caller stages cell edits with `stage(key, cell)`; this hook
 * debounces them into a single batch call, retries a failed batch with
 * backoff, and never discards a staged value — a failed cell stays staged
 * (and visibly failed) until it either saves or is overwritten by a newer
 * edit.
 */
import * as React from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveResult<TCell> {
  /** Stage (or overwrite) one cell's pending value. Resets the debounce
   * timer so a burst of fast edits collapses into one request. */
  stage: (key: string, cell: TCell) => void;
  /** Force an immediate flush of whatever's pending — used by "submit". */
  flush: () => Promise<void>;
  state: SaveState;
  lastSavedAt: Date | null;
  pendingCount: number;
  /** Keys currently staged-but-not-yet-confirmed-saved — a cell in this
   * set renders its "saving"/"dirty" affordance. */
  pendingKeys: ReadonlySet<string>;
  /** Keys whose last save attempt failed and is being retried. */
  failedKeys: ReadonlySet<string>;
}

export interface UseAutosaveOptions<TCell> {
  /** Sends one batch of staged cells to the server. Throwing (or a
   * rejected promise) marks every cell in the batch as failed and
   * schedules a retry. */
  save: (cells: Map<string, TCell>) => Promise<void>;
  debounceMs?: number;
  /** Backoff base — retry N waits `retryBaseMs * 2^(N-1)`, capped. */
  retryBaseMs?: number;
  maxRetryMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 600;
const DEFAULT_RETRY_BASE_MS = 1000;
const DEFAULT_MAX_RETRY_MS = 15000;

export function useAutosave<TCell>({
  save,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  retryBaseMs = DEFAULT_RETRY_BASE_MS,
  maxRetryMs = DEFAULT_MAX_RETRY_MS,
}: UseAutosaveOptions<TCell>): AutosaveResult<TCell> {
  const [state, setState] = React.useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null);
  const [pendingKeys, setPendingKeys] = React.useState<ReadonlySet<string>>(new Set());
  const [failedKeys, setFailedKeys] = React.useState<ReadonlySet<string>>(new Set());

  // Mutable staging area — not React state, so a fast typist doesn't
  // re-render on every keystroke. `pendingKeys` (state) mirrors its keys
  // for rendering; this map is the source of truth for what actually
  // gets sent.
  const stagedRef = React.useRef<Map<string, TCell>>(new Map());
  const debounceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttempt = React.useRef(0);
  const savingRef = React.useRef(false);

  const clearTimers = React.useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    debounceTimer.current = null;
    retryTimer.current = null;
  }, []);

  React.useEffect(() => clearTimers, [clearTimers]);

  const runSave = React.useCallback(async () => {
    if (savingRef.current) return; // one in-flight batch at a time
    const batch = new Map(stagedRef.current);
    if (batch.size === 0) return;

    savingRef.current = true;
    setState('saving');
    try {
      await save(batch);
      // Only cells still staged with the SAME value we just sent may be
      // cleared — a newer edit that landed mid-flight must survive.
      for (const [key, cell] of batch) {
        if (stagedRef.current.get(key) === cell) {
          stagedRef.current.delete(key);
        }
      }
      retryAttempt.current = 0;
      setFailedKeys(new Set());
      setPendingKeys(new Set(stagedRef.current.keys()));
      setLastSavedAt(new Date());
      setState(stagedRef.current.size > 0 ? 'saving' : 'saved');
      savingRef.current = false;
      if (stagedRef.current.size > 0) {
        // More edits arrived while this batch was in flight — go again.
        void runSave();
      }
    } catch {
      savingRef.current = false;
      setFailedKeys(new Set(batch.keys()));
      setState('error');
      const delay = Math.min(retryBaseMs * 2 ** retryAttempt.current, maxRetryMs);
      retryAttempt.current += 1;
      retryTimer.current = setTimeout(() => void runSave(), delay);
    }
  }, [save, retryBaseMs, maxRetryMs]);

  const stage = React.useCallback(
    (key: string, cell: TCell) => {
      stagedRef.current.set(key, cell);
      setPendingKeys(new Set(stagedRef.current.keys()));
      setFailedKeys((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      // A fresh edit cancels any pending retry backoff — it'll go out on
      // the normal debounce instead, so a fixed edit isn't stuck waiting
      // out an old failure's backoff window.
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      retryAttempt.current = 0;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => void runSave(), debounceMs);
    },
    [debounceMs, runSave],
  );

  const flush = React.useCallback(async () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    debounceTimer.current = null;
    retryTimer.current = null;
    await runSave();
  }, [runSave]);

  return {
    stage,
    flush,
    state,
    lastSavedAt,
    pendingCount: pendingKeys.size,
    pendingKeys,
    failedKeys,
  };
}
