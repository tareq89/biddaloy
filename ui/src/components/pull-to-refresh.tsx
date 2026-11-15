import { Loader2Icon } from 'lucide-react';
import * as React from 'react';

/** Content travels this fraction of the finger distance (D4). */
export const PULL_RATIO = 0.35;
/** Finger distance in px past which a release refreshes. */
export const PULL_THRESHOLD = 80;

const matches = (query: string) => typeof matchMedia === 'function' && matchMedia(query).matches;

export interface PullToRefreshProps {
  /** Re-fetch the list's own queries (D16): the caller passes its
   * `queryClient.invalidateQueries` call, so only that list refetches. */
  onRefresh: () => Promise<unknown> | void;
  /** Screen-reader text for the spinner, translated by the caller
   * (`@biddaloy/ui` stays translation-agnostic). */
  label: string;
  children: React.ReactNode;
}

/**
 * Pull-to-refresh for phone lists. Touch devices only (`pointer: coarse`);
 * anywhere else it renders its children unchanged. Reduced motion drops the
 * translate and keeps only the spinner.
 */
export function PullToRefresh({ onRefresh, label, children }: PullToRefreshProps) {
  const [touch] = React.useState(() => matches('(pointer: coarse)'));
  const [reduced] = React.useState(() => matches('(prefers-reduced-motion: reduce)'));
  const [pull, setPull] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);
  const startY = React.useRef<number | null>(null);

  if (!touch) return <>{children}</>;

  const onTouchStart = (e: React.TouchEvent) => {
    // Only a pull that begins with the page scrolled to the top.
    startY.current = window.scrollY <= 0 && !refreshing ? e.touches[0]!.clientY : null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    setPull(Math.max(0, e.touches[0]!.clientY - startY.current));
  };
  const onTouchEnd = () => {
    if (startY.current === null) return;
    startY.current = null;
    const past = pull >= PULL_THRESHOLD;
    setPull(0);
    if (!past) return;
    setRefreshing(true);
    void Promise.resolve(onRefresh()).finally(() => setRefreshing(false));
  };

  const offset = reduced ? 0 : pull * PULL_RATIO;
  return (
    <div
      data-slot="pull-to-refresh"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      {(refreshing || pull >= PULL_THRESHOLD) && (
        <div role="status" aria-live="polite" className="flex justify-center py-2">
          <Loader2Icon className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
          <span className="sr-only">{label}</span>
        </div>
      )}
      <div
        data-slot="pull-to-refresh-content"
        style={{
          transform: offset ? `translateY(${offset}px)` : undefined,
          transition: pull > 0 || reduced ? 'none' : 'transform 200ms ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}
