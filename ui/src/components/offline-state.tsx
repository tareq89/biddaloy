/**
 * [8.12.1]'s "offline navigation to an uncached route shows a designed
 * offline page, not a browser error" AC.
 *
 * Deliberately a sibling of `ErrorState` rather than a variant of it,
 * because being offline is not an error and should not read like one:
 *
 *   - `role="status"`, not `role="alert"` — a screen reader announces this
 *     politely. "You have no signal" does not warrant interrupting whatever
 *     the user was being read.
 *   - Dashed border (`EmptyState`'s treatment), not the solid one
 *     `ErrorState` uses. Visually this is "nothing here yet", not "something
 *     broke".
 *   - It never asks the user to report anything, and its caller
 *     (`route-error-boundary.tsx`) skips Sentry when it renders this.
 *
 * Copy is passed as English-default string props, matching every other
 * component in this package — `ui` stays translation-agnostic and the
 * consuming route supplies a translated string when it has one.
 */
import { WifiOff } from 'lucide-react';
import * as React from 'react';

import { Button } from './button';

export interface OfflineStateProps {
  /** Renders as an `<h1>` — [8.9.7]: `useRouteFocus` looks for exactly one
   * page-level heading per route, and when this replaces a route's whole
   * output it is that route's heading. */
  title?: string;
  /** Required to say *what the user can do*, on the same reasoning as
   * `EmptyState`'s required `explanation`: "You're offline" alone is a dead
   * end. It has a default here (unlike `EmptyState`) because there is
   * exactly one honest thing to say about being offline, and every caller
   * would otherwise retype it. */
  explanation?: string;
  onRetry: () => void;
  retryLabel?: string;
  /** Optional second affordance, mirroring `ErrorState.onHome` — the
   * caller supplies the navigation, this component stays router-agnostic. */
  onHome?: () => void;
  homeLabel?: string;
  /** Overrides the default `WifiOff` glyph. */
  icon?: React.ReactNode;
}

export function OfflineState({
  title = "You're offline",
  explanation = 'This page needs a connection to load. Check your network and try again — anything already loaded is still available.',
  onRetry,
  retryLabel = 'Try again',
  onHome,
  homeLabel = 'Go home',
  icon,
}: OfflineStateProps) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center"
    >
      <div className="text-muted-foreground [&_svg]:size-8">
        {/* `aria-hidden` on the default: the heading below already says
            "offline", and an announced icon would say it twice. */}
        {icon ?? <WifiOff aria-hidden="true" />}
      </div>
      <h1 className="font-medium">{title}</h1>
      <p className="max-w-prose text-sm text-muted-foreground">{explanation}</p>
      <div className="mt-2 flex items-center gap-2">
        <Button type="button" variant="outline" onClick={onRetry}>
          {retryLabel}
        </Button>
        {onHome && (
          <Button type="button" variant="ghost" onClick={onHome}>
            {homeLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
