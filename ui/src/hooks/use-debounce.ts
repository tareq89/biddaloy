import * as React from 'react';

/**
 * Returns `value`, delayed by `delayMs` since its last change — the
 * standard trailing-edge debounce. A caller driving a search-as-you-type
 * query keys its queryFn off the debounced value, not the raw input
 * state, so keystrokes typed faster than `delayMs` apart collapse into a
 * single outgoing request instead of one per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);

  return debounced;
}
