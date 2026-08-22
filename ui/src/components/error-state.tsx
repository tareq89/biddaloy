/**
 * A retry affordance and plain-language messaging — never a raw error
 * payload. `message` is typed as `string`, not `Error | unknown`, so a
 * caller reaching for `error.message`/a translated, human string is the
 * only thing that type-checks; passing a raw `Error` object (or `unknown`
 * from a catch block) directly is a compile error, not a `[object Object]`
 * rendered to a parent whose fee dashboard just broke.
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
      className="flex flex-col items-center gap-2 rounded-lg border border-border p-8 text-center"
    >
      {icon && <div className="text-muted-foreground [&_svg]:size-8">{icon}</div>}
      <p className="text-sm text-muted-foreground">{message}</p>
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
