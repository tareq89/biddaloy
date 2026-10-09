/**
 * [52.5.1] D25: after a decision the detail page sends the reviewer back with `?decided=<id>`;
 * focus the row that now sits where the decided one was, so a keyboard user can keep going.
 */
import { useNavigate, useSearch } from '@tanstack/react-router';
import * as React from 'react';

/** Visible inbox order from the last settled render; survives the list unmounting for the detail. */
let lastInboxOrder: string[] = [];

/** `useRouteFocus` moves focus to the `<h1>` after ~100 ms; wait for it. */
const AFTER_ROUTE_FOCUS_MS = 150;

export function useFocusAfterDecision(ids: readonly string[] | undefined, settled: boolean): void {
  const decided = useSearch({
    strict: false,
    select: (s) => (typeof s.decided === 'string' ? s.decided : undefined),
  });
  const navigate = useNavigate();
  const handled = React.useRef<string | undefined>(undefined);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  React.useEffect(() => {
    if (!decided && settled && ids) lastInboxOrder = [...ids];
  }, [decided, settled, ids]);

  React.useEffect(() => {
    if (!decided || !settled || !ids || handled.current === decided) return;
    handled.current = decided;
    const index = Math.max(0, lastInboxOrder.indexOf(decided));
    const nextId = ids[Math.min(index, ids.length - 1)];
    // Not cleared on re-render (that would lose the one-shot); `mounted` guards unmount.
    setTimeout(() => {
      if (!mounted.current) return;
      const target = nextId
        ? document.querySelector<HTMLElement>(`[data-focus-anchor="${nextId}"]`)
        : document.querySelector<HTMLElement>('main h1');
      if (target) {
        if (!nextId) target.tabIndex = -1;
        target.focus();
      }
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => ({ ...prev, decided: undefined }),
        replace: true,
      });
    }, AFTER_ROUTE_FOCUS_MS);
  }, [decided, settled, ids, navigate]);
}
