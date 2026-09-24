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
  /** Force an immediate flush of whatever's pending — used by "submit".
   * Waits out any in-flight batch, then sends whatever is still staged
   * (including edits made mid-flight) until nothing is left. Resolves
   * `true` once every staged cell is saved, `false` as soon as a save
   * fails — a caller must not submit on `false`. */
  flush: () => Promise<boolean>;
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
  // The in-flight batch, if any — resolves `true` if it saved, `false` if
  // it failed. Doubles as the "one batch at a time" lock.
  const inFlightRef = React.useRef<Promise<boolean> | null>(null);

  const clearTimers = React.useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    debounceTimer.current = null;
    retryTimer.current = null;
  }, []);

  React.useEffect(() => clearTimers, [clearTimers]);

  const runSave = React.useCallback((): Promise<boolean> => {
    // One in-flight batch at a time — a caller arriving mid-flight gets
    // that batch's outcome instead of starting a second request.
    if (inFlightRef.current) return inFlightRef.current;
    const batch = new Map(stagedRef.current);
    if (batch.size === 0) return Promise.resolve(true);

    setState('saving');
    const attempt = (async () => {
      try {
        // Wrapped so even a `save` that throws synchronously settles only
        // after `inFlightRef` is assigned below, never before.
        await (async () => save(batch))();
      } catch {
        inFlightRef.current = null;
        setFailedKeys(new Set(batch.keys()));
        setState('error');
        const delay = Math.min(retryBaseMs * 2 ** retryAttempt.current, maxRetryMs);
        retryAttempt.current += 1;
        retryTimer.current = setTimeout(() => void runSave(), delay);
        return false;
      }
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
      inFlightRef.current = null;
      if (stagedRef.current.size > 0) {
        // More edits arrived while this batch was in flight — go again.
        void runSave();
      }
      return true;
    })();
    inFlightRef.current = attempt;
    return attempt;
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
    while (stagedRef.current.size > 0 || inFlightRef.current) {
      if (!(await runSave())) return false;
    }
    return true;
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
