/**
 * A retry affordance and plain-language messaging — never a raw error
 * payload. `message` is typed as `string`, not `Error | unknown`, so a
 * caller reaching for `error.message`/a translated, human string is the
 * only thing that type-checks; passing a raw `Error` object (or `unknown`
 * from a catch block) directly is a compile error, not a `[object Object]`
 * rendered to a parent whose fee dashboard just broke.
 *
 * ---
 *
 * [8.13.11]: this is the one member of the empty/loading/error family that
 * reports a *fault*, and its solid border + `shadow-e1` are what say so —
 * see `EmptyState`'s file comment for the full border/elevation table
 * across all three states and why only this one is elevated.
 *
 * The icon well is `bg-destructive/10 text-destructive`: not a new colour,
 * the exact pairing `button.tsx`'s `destructive` variant already ships, so
 * "danger" looks the same on a state as it does on a button. It is an
 * alpha tint of an existing token rather than a new solid, so like every
 * other `/10` blend in the package it has no `CONTRAST_PAIRS` row of its
 * own; the text that has to be legible (`message`) is
 * `text-muted-foreground` on `bg-card`, which is verified.
 */
import * as React from 'react';

import { Button } from './button';

export interface ErrorStateProps {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  icon?: React.ReactNode;
  /** [8.9.8]'s route-error-boundary AC — "offers a retry and a route
   * home." Optional so every existing caller (a failed data-table fetch,
   * say) that only wants a retry keeps working unchanged. Router-agnostic
   * on purpose, same as the rest of this file: the caller supplies the
   * navigation, this component only renders the button. */
  onHome?: () => void;
  homeLabel?: string;
}

export function ErrorState({
  message,
  onRetry,
  retryLabel = 'Try again',
  icon,
  onHome,
  homeLabel = 'Go home',
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      data-slot="error-state"
      className="flex flex-col items-center gap-2 rounded-lg border border-border-subtle bg-card p-8 text-center shadow-e1"
    >
      {icon && (
        <div className="mb-1 flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive [&_svg]:size-8">
          {icon}
        </div>
      )}
      <p className="max-w-prose text-sm text-muted-foreground">{message}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
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
