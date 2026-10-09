/**
 * `FilterBar`'s ([8.14.8]) state engine — deliberately pure and router-
 * agnostic (takes `values`/`onChange`, same contract `ListShellState`/
 * `ListShellActions` already give every list page; never calls
 * `useListShellState` itself), so this hook is testable and Storybook-
 * renderable with no router in the tree, matching `list-shell.tsx`'s own
 * documented rule for why the shells stay thin.
 *
 * Owns three things every page's hand-rolled filter bar used to
 * duplicate (`students/index.tsx:140-166`, `guardians/index.tsx:59-79`,
 * `invoices/index.tsx:113-133`, `staff/index.tsx:~103-123`, before
 * [8.14.10] deletes those blocks):
 *
 * 1. **Debounced local echo** for `text`/`number-range` fields — typing
 *    updates the input immediately but only calls `onChange` 300ms after
 *    the last keystroke, so a fast typist doesn't fire a request per
 *    character.
 * 2. **Bengali-digit normalization on commit** — `toLatinDigits(raw).trim()`
 *    right before the debounced `onChange` call, never on the displayed
 *    text, so a user typing `০১২` sees their own keystrokes rather than
 *    watching the input rewrite itself mid-word.
 * 3. **Chip derivation from `values` directly, not from `fields`** — the
 *    fix for the "invisible active filter" bug class this ticket exists
 *    to kill (`invoices/index.tsx` accepts `student_id` in its URL schema
 *    but renders no control for it). A key present in `values` with no
 *    matching descriptor still produces a chip, just with `label: null`
 *    so `FilterBar` can fall back to `t('filters.unknownFilter', ...)`.
 */
import * as React from 'react';

import { toLatinDigits } from '../utils/digits';

import type { FilterFieldDescriptor } from './filter-bar';

export interface ActiveFilterChip {
  key: string;
  /** Already-resolved display text for a key a descriptor covers — e.g. a
   * select option's *label*, never its raw `value`/id, and composed from
   * the caller-supplied `field.label` so `FilterBar` doesn't need its own
   * i18n lookup for known fields. `null` when no descriptor in `fields`
   * declares this key: `FilterBar` renders
   * `t('filters.unknownFilter', { key, value })` in that case instead. */
  label: string | null;
  value: string;
}

export interface UseFilterBarStateOptions {
  fields: readonly FilterFieldDescriptor[];
  /** `ListShellState.filters`. */
  values: Record<string, string>;
  /** `ListShellActions.setFilters` — a string sets a key, `null` clears
   * it. Absent key leaves the URL param untouched (`use-list-url-state.ts`),
   * so every clearing path here always passes `null` explicitly, never
   * omits the key. */
  onChange: (patch: Record<string, string | null>) => void;
  /** @default 300 */
  debounceMs?: number;
  /** Display-only; the URL keeps the raw value. Used for `date-range` and `number-range` chips. */
  formatValue?: (kind: 'date' | 'number', value: string) => string;
}

export interface UseFilterBarStateResult {
  /** Local echo for every debounced (`text`/`number-range`) key, keyed by
   * that field's `key` (or `minKey`/`maxKey`). Always defined once a field
   * declares the key — read this for the input's `value`, not `values`
   * directly, or every keystroke would round-trip through the parent. */
  localValues: Record<string, string>;
  /** Updates a debounced field's local echo immediately, and commits the
   * normalized value through `onChange` after `debounceMs` of inactivity.
   * For `text`/`number-range` fields. */
  setLocalValue: (key: string, raw: string) => void;
  /** Commits a value immediately, no debounce — for `select`/`date-range`/
   * `checkbox` fields, none of which have a "typing" concept to debounce. */
  setValue: (key: string, value: string | null) => void;
  chips: ActiveFilterChip[];
  clearFilter: (key: string) => void;
  /** Clears every currently active key in `values` — descriptor-covered or
   * not — in a single `onChange` call. */
  clearAll: () => void;
  activeCount: number;
}

function debouncedKeysOf(fields: readonly FilterFieldDescriptor[]): string[] {
  const keys: string[] = [];
  for (const field of fields) {
    if (field.kind === 'text') keys.push(field.key);
    else if (field.kind === 'number-range') keys.push(field.minKey, field.maxKey);
  }
  return keys;
}

/** Resolves a chip's display label for a key a descriptor covers — `null`
 * (meaning "no descriptor covers this key") is handled by the caller. */
function labelFor(
  fields: readonly FilterFieldDescriptor[],
  key: string,
  value: string,
  formatValue?: UseFilterBarStateOptions['formatValue'],
): string | null {
  const show = (kind: 'date' | 'number') => formatValue?.(kind, value) ?? value;
  for (const field of fields) {
    switch (field.kind) {
      case 'text':
        if (field.key === key)
          return `${field.label}: ${field.formatChip ? field.formatChip(value) : value}`;
        break;
      case 'select':
        if (field.key === key) {
          const option = field.options.find((candidate) => candidate.value === value);
          return `${field.label}: ${option?.label ?? value}`;
        }
        break;
      case 'checkbox':
        // A boolean field's chip is its own label ("Flagged"), not
        // "Flagged: true" — matching `fees/dues.tsx`'s existing
        // `flagged` toggle semantics.
        if (field.key === key) return field.label;
        break;
      case 'date-range':
        if (field.fromKey === key) return `${field.fromLabel}: ${show('date')}`;
        if (field.toKey === key) return `${field.toLabel}: ${show('date')}`;
        break;
      case 'number-range':
        if (field.minKey === key) return `${field.minLabel}: ${show('number')}`;
        if (field.maxKey === key) return `${field.maxLabel}: ${show('number')}`;
        break;
    }
  }
  return null;
}

export function useFilterBarState({
  fields,
  values,
  onChange,
  debounceMs = 300,
  formatValue,
}: UseFilterBarStateOptions): UseFilterBarStateResult {
  const debouncedKeys = React.useMemo(() => debouncedKeysOf(fields), [fields]);
  // Comma-joined so the effect below has a stable primitive dependency —
  // an array literal from `useMemo` is a new reference every render `fields`
  // itself is a fresh array (Storybook/page callers rarely `useMemo` their
  // own descriptor list), which would otherwise re-run the resync effect,
  // and reset in-flight local edits, on every unrelated re-render.
  const debouncedKeysKey = debouncedKeys.join('\u0000');

  const [localValues, setLocalValues] = React.useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const key of debouncedKeys) initial[key] = values[key] ?? '';
    return initial;
  });

  // Stale-closure guards: the `setTimeout` below reads *these* refs when it
  // fires, not whatever `values`/`onChange` closed over at the keystroke
  // that started it — a concurrent change to a *different* filter key
  // landing in between must not be reverted by this timeout committing a
  // patch built from a stale `values` snapshot. Same `filtersRef`/
  // `actionsRef` pattern every duplicated page block used
  // (`students/index.tsx:145-154`), centralized here instead.
  const valuesRef = React.useRef(values);
  valuesRef.current = values;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const timeoutsRef = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Last value THIS hook committed per key. The router applies a commit a few ms (or, under CI
  // load, hundreds) later; if the user typed more meanwhile, that echo is stale, not external,
  // and resetting the input to it would drop the newer keystrokes.
  const lastCommittedRef = React.useRef<Record<string, string>>({});

  // Content hash of the committed values this hook actually echoes, used as
  // the resync effect's dependency instead of the `values` object itself.
  const incomingValuesKey = debouncedKeys.map((key) => values[key] ?? '').join('\u0000');

  // External resync: a `<Link>` navigation, a Back press, or a sibling
  // control (`clearAll`) changes `values` out from under any in-flight
  // local edit. Reset the echo only when the incoming committed value
  // differs from the *normalized* current echo — not the raw echo, and
  // not "did the committed value change since last render". Comparing
  // against the raw echo would rewrite `০১২` to `012` mid-keystroke the
  // instant this hook's own debounce commit lands (`incoming` becomes
  // `'012'`, the raw echo is still `'০১২'`, those never match even though
  // the echo is exactly what produced that commit). Normalizing the echo
  // before comparing fixes that: `toLatinDigits('০১২').trim() === '012'
  // === incoming`, so no reset fires. A genuine external change (Back
  // press, `<Link>`, `clearAll`) still resets correctly, since then
  // `incoming` differs from the normalized echo too.
  React.useEffect(() => {
    setLocalValues((current) => {
      let changed = false;
      const next = { ...current };
      for (const key of debouncedKeys) {
        const incoming = valuesRef.current[key] ?? '';
        if (lastCommittedRef.current[key] === incoming) continue;
        delete lastCommittedRef.current[key];
        const normalizedEcho = toLatinDigits(current[key] ?? '').trim();
        if (incoming !== normalizedEcho) {
          next[key] = incoming;
          changed = true;
        }
      }
      return changed ? next : current;
    });
    // Keyed on the committed values' *contents*, not on `values`' object
    // identity, and read through `valuesRef` inside. `values` is a fresh
    // object every render — `useListShellState` rebuilds it with
    // `{ ...urlState.filters }` (`use-list-shell-state.ts`) and every page
    // passes that straight through — so depending on it re-ran this effect
    // on unrelated re-renders. Mid-debounce that meant `incoming` (the last
    // committed value) ≠ `normalizedEcho` (what the user is still typing),
    // and the in-flight keystrokes were reset: type `Rah`, wait for the
    // 300ms commit, and the `keepPreviousData` refetch landing would revert
    // anything typed after it. Serializing the debounced keys' committed
    // values fires the effect only on a genuine external change.
    // `debouncedKeysKey` (not `debouncedKeys`) intentionally — see its own
    // comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingValuesKey, debouncedKeysKey]);

  // Timers must not outlive the component (a commit firing into an
  // unmounted list page), and a fast re-type of the same field must not
  // leave the previous timer racing the new one — `setLocalValue` below
  // already clears the previous timeout per key before starting a new one;
  // this covers the unmount case that per-key clearing can't.
  React.useEffect(() => {
    const timeouts = timeoutsRef.current;
    return () => {
      for (const timeout of Object.values(timeouts)) clearTimeout(timeout);
    };
  }, []);

  const setLocalValue = React.useCallback(
    (key: string, raw: string) => {
      setLocalValues((current) => ({ ...current, [key]: raw }));

      const existing = timeoutsRef.current[key];
      if (existing !== undefined) clearTimeout(existing);

      timeoutsRef.current[key] = setTimeout(() => {
        delete timeoutsRef.current[key];
        const normalized = toLatinDigits(raw).trim();
        const currentCommitted = valuesRef.current[key] ?? '';
        if (normalized === currentCommitted) return;
        lastCommittedRef.current[key] = normalized;
        onChangeRef.current({ [key]: normalized === '' ? null : normalized });
      }, debounceMs);
    },
    [debounceMs],
  );

  const setValue = React.useCallback((key: string, value: string | null) => {
    onChangeRef.current({ [key]: value });
  }, []);

  const chips = React.useMemo<ActiveFilterChip[]>(() => {
    return Object.entries(values)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => ({ key, value, label: labelFor(fields, key, value, formatValue) }));
  }, [fields, values, formatValue]);

  // A pending debounced commit (`setLocalValue`'s `setTimeout`) for `key`
  // must not survive a clear — otherwise a keystroke typed just before
  // "Clear" or "Clear all" fires resurrects the filter a moment after the
  // user cleared it, once that stale timer lands.
  const cancelPending = React.useCallback((key: string) => {
    const existing = timeoutsRef.current[key];
    if (existing !== undefined) {
      clearTimeout(existing);
      delete timeoutsRef.current[key];
    }
  }, []);

  const clearFilter = React.useCallback(
    (key: string) => {
      cancelPending(key);
      delete lastCommittedRef.current[key];
      onChangeRef.current({ [key]: null });
    },
    [cancelPending],
  );

  const clearAll = React.useCallback(() => {
    const patch: Record<string, string | null> = {};
    for (const key of Object.keys(valuesRef.current)) {
      if (valuesRef.current[key] !== undefined && valuesRef.current[key] !== '') patch[key] = null;
    }
    for (const key of Object.keys(timeoutsRef.current)) cancelPending(key);
    lastCommittedRef.current = {};
    onChangeRef.current(patch);
  }, [cancelPending]);

  return {
    localValues,
    setLocalValue,
    setValue,
    chips,
    clearFilter,
    clearAll,
    activeCount: chips.length,
  };
}
