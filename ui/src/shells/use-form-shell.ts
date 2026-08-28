/**
 * The non-layout half of `FormShell`'s acceptance criteria: validation
 * timing, autosave/restoration, the unsaved-changes warning, and mapping
 * server-side field errors onto the right input. Kept as hooks/helpers
 * rather than folded into `FormShell` itself, since none of them need
 * `FormShell`'s markup — a page composing its own layout around
 * `react-hook-form` directly can still use all four.
 */
import * as React from 'react';
import type { FieldPath, FieldValues, UseFormSetError } from 'react-hook-form';

import { currentSessionGeneration, getActiveTenant } from '../api/auth-state';
import { formDraftKey } from '../api/form-draft-storage';

/**
 * "Validation runs on blur and on submit — never on every keystroke" is a
 * `useForm` config, not something a wrapper component can enforce on
 * children it doesn't control — so this pins it: spread the result into
 * `useForm(useFormShellMode())` and both `mode` and `reValidateMode` are
 * fixed to `'onBlur'`, overridable only by a caller deliberately spreading
 * their own options *after* this one.
 */
export function useFormShellMode(): { mode: 'onBlur'; reValidateMode: 'onBlur' } {
  return { mode: 'onBlur', reValidateMode: 'onBlur' };
}

/** `setError` for every server-side field error at once, typed against
 * the same field paths `useForm<TFieldValues>` knows about — a server
 * error keyed by a field name that doesn't exist on the form is a type
 * error at the call site, not a silently-dropped error the user never
 * sees. */
export function applyServerFieldErrors<TFieldValues extends FieldValues>(
  setError: UseFormSetError<TFieldValues>,
  serverErrors: Partial<Record<FieldPath<TFieldValues>, string>>,
): void {
  for (const [field, message] of Object.entries(serverErrors)) {
    if (typeof message !== 'string') continue;
    setError(field as FieldPath<TFieldValues>, { type: 'server', message });
  }
}

/** Warns on tab close/refresh/navigation-away when `hasUnsavedChanges` is
 * true — wire `form.formState.isDirty` straight in. Native
 * `beforeunload` covers closing the tab or navigating to a different
 * origin; in-app route changes within this SPA are a router-level
 * concern (TanStack Router's `useBlocker`) that a real page wires up
 * separately once it has actual routes to block — this hook only owns
 * the part that's true regardless of routing setup. */
export function useWarnUnsavedChanges(hasUnsavedChanges: boolean): void {
  React.useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      // Chrome ignores a custom message and shows its own, but still
      // requires `returnValue` to be set for the prompt to appear at all.
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);
}

export interface UseFormAutosaveResult<TValues> {
  /** Computed on mount from whatever was in `localStorage` then, and
   * kept in sync with every write/removal this hook itself makes
   * (autosave, `discardDraft`/`clearDraft`) — asking whether to restore,
   * not silently applying a draft over whatever the caller already
   * rendered, is the caller's job, not this hook's. Only a write from
   * *outside* this hook's own effect (another tab, a caller poking
   * `localStorage` directly) can make this stale; this hook doesn't
   * listen for the `storage` event to catch that. */
  draftAvailable: boolean;
  /** Reads the current draft without clearing it — call `discardDraft`/
   * `clearDraft` separately if the caller's restoration flow should also
   * remove it. */
  restoreDraft: () => TValues | undefined;
  discardDraft: () => void;
  /** Call on successful submit — a saved draft for a form that already
   * succeeded is stale, not a recovery aid. */
  clearDraft: () => void;
}

/** Debounced localStorage autosave, keyed per-form so two different forms
 * on the same origin don't collide. Fails silently on a full/unavailable
 * `localStorage` (private browsing, quota) — autosave is a convenience on
 * top of a form that already works, not something whose failure should
 * block submission.
 *
 * [8.12.3]: the storage key now also carries the **active tenant**
 * (`formDraftKey`), and `clearAuthState()` purges every draft on logout.
 * Before that, an administrator of two schools was offered school A's
 * abandoned draft while filling in the same form at school B, and a draft
 * outlived the session that typed it. Callers pass the same `key` as
 * before — the scoping happens here. */
export function useFormAutosave<TValues>(
  key: string,
  values: TValues,
  options: { enabled?: boolean; debounceMs?: number } = {},
): UseFormAutosaveResult<TValues> {
  const { enabled = true, debounceMs = 500 } = options;
  const tenantId = getActiveTenant();
  const storageKey = formDraftKey(key, tenantId);

  const [draftAvailable, setDraftAvailable] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(storageKey) !== null;
    } catch {
      // Accessing window.localStorage itself can throw (blocked storage,
      // some sandboxed/cross-origin contexts) — same "fails silently"
      // contract as the write/restore paths below, but this one runs
      // during the initial render, so an uncaught throw here would take
      // the whole component down with it, not just skip the autosave.
      return false;
    }
  });

  // Tracks the last value actually written, per storage key — a caller
  // re-rendering with unchanged `values` (most renders, for most forms)
  // shouldn't re-serialize and rewrite localStorage every debounce cycle.
  const lastWrittenRef = React.useRef<{ storageKey: string; serialized: string } | null>(null);

  React.useEffect(() => {
    if (!enabled) return;
    // Captured at arm time and re-checked when the timer fires. The
    // debounce means a write is routinely still pending when the session
    // ends: a mid-session 401 calls `clearAuthState()`, which wipes every
    // draft, but navigation to `/login` is async and the form can still be
    // mounted when this fires. Without the check it would write the draft
    // straight back under the departed session's key, where the next
    // person at the browser could restore it — undoing the purge that had
    // just run. The same guard stops a tenant switch from writing school
    // A's typed values under school B's key.
    const armedGeneration = currentSessionGeneration();
    const armedTenant = tenantId;
    const timeout = setTimeout(() => {
      if (currentSessionGeneration() !== armedGeneration) return;
      if (getActiveTenant() !== armedTenant) return;
      const serialized = JSON.stringify(values);
      if (
        lastWrittenRef.current?.storageKey === storageKey &&
        lastWrittenRef.current.serialized === serialized
      ) {
        return;
      }
      try {
        window.localStorage.setItem(storageKey, serialized);
        lastWrittenRef.current = { storageKey, serialized };
        setDraftAvailable(true);
      } catch {
        // Quota exceeded or storage disabled — see this function's own
        // header comment on why this stays silent.
      }
    }, debounceMs);
    return () => clearTimeout(timeout);
  }, [enabled, storageKey, tenantId, values, debounceMs]);

  function restoreDraft(): TValues | undefined {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as TValues) : undefined;
    } catch {
      return undefined;
    }
  }

  function discardDraft(): void {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // See the state initializer above — storage access itself can
      // throw, not just a specific operation.
    }
    // Mark *these* values as already handled, not just "nothing written"
    // — the debounce effect above reschedules on every render (`values`
    // is typically a fresh object each time), so a still-pending or
    // soon-to-be-scheduled timer for the very values just discarded
    // would otherwise immediately rewrite localStorage and resurrect
    // the draft. A real edit still changes `values` and clears this.
    lastWrittenRef.current = { storageKey, serialized: JSON.stringify(values) };
    setDraftAvailable(false);
  }

  return { draftAvailable, restoreDraft, discardDraft, clearDraft: discardDraft };
}
