/**
 * A whole-route state that is *not* an application fault: [8.12.1]'s
 * offline page and [8.12.2]'s "this tab is running an older version"
 * page. `RouteErrorFallback` picks between this and `ErrorState`.
 *
 * Deliberately a sibling of `ErrorState` rather than a variant of it,
 * because neither of these is an error and neither should read like one —
 * see `EmptyState`'s file comment for the border/elevation table shared
 * across the family; all members now share one card look and differ by
 * icon-well tone and role. Also:
 *
 *   - `role="status"`, not `role="alert"` — a screen reader announces this
 *     politely. "You have no signal", or "a newer version exists", does not
 *     warrant interrupting whatever the user was being read.
 *   - It never asks the user to report anything, and its caller
 *     (`route-error-boundary.tsx`) skips Sentry when it renders this.
 *
 * Copy and icon are the caller's, with no defaults: the two situations say
 * genuinely different things, and a default belonging to one of them would
 * be wrong half the time. `RouteErrorFallback` owns both sets of strings
 * so a consuming app can translate them.
 */
import * as React from 'react';

import { useTranslation } from '../i18n';

import { Button } from './button';

export interface RouteStatusStateProps {
  /** Renders as an `<h1>` — [8.9.7]: `useRouteFocus` looks for exactly one
   * page-level heading per route, and when this replaces a route's whole
   * output it is that route's heading. */
  title: string;
  /** Required to say *what the user can do*, on the same reasoning as
   * `EmptyState`'s required `explanation`: "You're offline" alone is a dead
   * end. */
  explanation: string;
  onRetry: () => void;
  retryLabel: string;
  /** Optional second affordance, mirroring `ErrorState.onHome` — the
   * caller supplies the navigation, this component stays router-agnostic. */
  onHome?: () => void;
  homeLabel?: string;
  /** Rendered `aria-hidden` by the caller: the heading already says what
   * this is, and an announced glyph would say it twice. */
  icon: React.ReactNode;
}

export function RouteStatusState({
  title,
  explanation,
  onRetry,
  retryLabel,
  onHome,
  homeLabel,
  icon,
}: RouteStatusStateProps) {
  const { t } = useTranslation('common');
  return (
    <div
      role="status"
      data-slot="route-status-state"
      className="flex flex-col items-center gap-2 rounded-lg border border-border-subtle bg-surface px-4 py-10 text-center shadow-e1"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-text-secondary [&_svg]:size-6">
        {icon}
      </div>
      <h1 className="text-h3">{title}</h1>
      <p className="max-w-prose text-text-secondary">{explanation}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Button type="button" variant="outline" onClick={onRetry}>
          {retryLabel}
        </Button>
        {onHome && (
          <Button type="button" variant="ghost" onClick={onHome}>
            {homeLabel ?? t('routeError.home')}
          </Button>
        )}
      </div>
    </div>
  );
}
