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
}

export function ErrorState({ message, onRetry, retryLabel = 'Try again', icon }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-lg border border-border p-8 text-center"
    >
      {icon && <div className="text-muted-foreground [&_svg]:size-8">{icon}</div>}
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button type="button" variant="outline" onClick={onRetry} className="mt-2">
        {retryLabel}
      </Button>
    </div>
  );
}
