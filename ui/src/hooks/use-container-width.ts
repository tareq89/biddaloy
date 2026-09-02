import * as React from 'react';

/**
 * Observed border-box width (px) of the element `ref` points at, or `null`
 * until the first `ResizeObserver` callback fires. `null` means "not
 * measured yet" — callers must define their own fallback for that state,
 * not treat it as `0`.
 *
 * ## Why this exists instead of a CSS breakpoint
 *
 * `DataTable`'s card-mode switch ([8.14.7]) has to react to the width of
 * its own root element, not the viewport. A table sitting inside a narrow
 * detail-pane or a dialog is narrow even on a 1440px screen — a
 * `useMediaQuery`-style viewport check would get that wrong, and CSS alone
 * (`@container`) can't pick between two *React* trees (a `<table>` vs a
 * `<ul>` of cards), only between two pre-rendered ones. So the measurement
 * has to happen in JS, and the decision has to happen in the component
 * that owns both trees.
 *
 * ## Why `null` guards SSR and jsdom
 *
 * `typeof window === 'undefined'` covers server rendering (no DOM at all).
 * `typeof ResizeObserver === 'function'` covers `ui/src/test/
 * jsdom-polyfills.ts`, which stubs `ResizeObserver` as a no-op class (it
 * exists, but never calls its callback) so Radix's popper positioning
 * doesn't throw under jsdom — that no-op means this hook's returned width
 * never leaves `null` inside a vitest `:jsdom` test. Callers that need to
 * force a layout under test use an explicit prop (`DataTable`'s
 * `layout="cards"`/`layout="table"`) rather than depending on this hook
 * actually firing — see `data-table.test.tsx`.
 */
export function useContainerWidth(ref: React.RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof ResizeObserver !== 'function') return;
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const measured = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      setWidth(measured);
    });
    observer.observe(element);

    return () => observer.disconnect();
    // `ref` is a stable object identity across renders (from `useRef`), so
    // `ref.current` is read once per effect run rather than re-subscribed
    // on every render — the effect re-runs only if the caller passes a
    // genuinely new ref object.
  }, [ref]);

  return width;
}
