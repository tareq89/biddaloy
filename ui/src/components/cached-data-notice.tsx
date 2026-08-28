/**
 * [8.12.3] The visible half of the offline read cache: an inline note that
 * says, plainly, that what is on screen is **saved data** and how old it
 * is.
 *
 * The epic's rule is that cached data is only acceptable when it is
 * labelled. Silently rendering yesterday's class roster as if it were
 * today's is worse than an error message, because the user acts on it. So
 * this component is not decoration — it is the condition under which
 * `offlineCachedQueryFn` is allowed to serve anything at all.
 *
 * Renders `null` for fresh network data. There is no "you are up to date"
 * badge: a permanent banner is a banner people stop reading, and by the
 * time it says something important it is furniture.
 *
 * Composition only — `text-muted-foreground`/`bg-muted`/`border-border-subtle`
 * from the design system's tokens and `cn`, the way `empty-state.tsx`
 * does. No new primitive, no bespoke colour.
 */
import type { QueryKey } from '@tanstack/react-query';
import * as React from 'react';

import { useOnline } from '../hooks/use-online';
import { useQueryFreshness } from '../hooks/use-query-freshness';
import { useLocale, useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';
import { formatRelativeAge } from '../utils/date';

export interface CachedDataNoticeProps {
  /** The *same* key the query uses — `studentKeys.list(filters)`, not a
   * hand-written array. `api/freshness.ts` looks the age up by
   * `hashKey`, so a key that differs by even one filter silently reports
   * nothing rather than reporting the wrong age. */
  queryKey: QueryKey;
  className?: string;
}

/** How often the rendered age is recomputed. The freshness entry itself
 * never changes while cached data sits on screen, so without a tick the
 * one number this component exists to communicate — "from 1 minute ago" —
 * would keep saying that an hour later. A minute is the resolution
 * `formatRelativeAge` reports at, so anything finer would re-render
 * without changing a pixel. */
const AGE_TICK_MS = 60_000;

export function CachedDataNotice({ queryKey, className }: CachedDataNoticeProps) {
  const freshness = useQueryFreshness(queryKey);
  const online = useOnline();
  const { t } = useTranslation();
  const { locale } = useLocale();

  const stale = freshness !== undefined && freshness.source !== 'network';
  // Only ticks while something stale is actually on screen: a fresh page
  // has no notice to age, and an interval per mounted list would be a
  // steady background cost for nothing.
  const [, forceTick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!stale) return;
    const timer = setInterval(forceTick, AGE_TICK_MS);
    return () => clearInterval(timer);
  }, [stale]);

  // No entry yet (query still loading, or never ran) or a genuine
  // network response — nothing to warn about either way.
  if (!freshness || freshness.source === 'network') return null;

  const age = formatRelativeAge(freshness.fetchedAt, locale);

  return (
    <p
      // `status`, not `alert`: assistive tech should hear this when it
      // reaches it or on a polite update, not have the current sentence
      // interrupted. Stale data is important, not urgent.
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-1 rounded-md border border-border-subtle bg-muted px-3 py-2 text-sm text-muted-foreground',
        className,
      )}
    >
      <span>{t('offline.showingSavedData', { age })}</span>
      {!online && <span>{t('offline.youAreOffline')}</span>}
    </p>
  );
}
