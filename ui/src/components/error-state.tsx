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
 * Shares the card look of the empty/error/route-status family (table in
 * `empty-state.tsx`); what says "fault" is `role="alert"` and the
 * `bg-status-overdue-bg text-status-overdue-fg` icon well, the same pair
 * the overdue status uses elsewhere. Default labels are translated here
 * (`actions.retry`, `routeError.home`) so a caller never has to pass them.
 */
import { RotateCcwIcon, TriangleAlertIcon } from 'lucide-react';
import * as React from 'react';

import { useTranslation } from '../i18n';

import { Button } from './button';

export interface ErrorStateProps {
  /** Optional heading above the message, rendered as an `<h2>`. */
  title?: string;
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
  title,
  message,
  onRetry,
  retryLabel,
  icon,
  onHome,
  homeLabel,
}: ErrorStateProps) {
  const { t } = useTranslation('common');
  return (
    <div
      role="alert"
      data-slot="error-state"
      className="flex flex-col items-center gap-2 rounded-lg border border-border-subtle bg-surface px-4 py-10 text-center shadow-e1"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-status-overdue-bg text-status-overdue-fg [&_svg]:size-6">
        {icon ?? <TriangleAlertIcon aria-hidden="true" />}
      </div>
      {title && <h2 className="text-h3">{title}</h2>}
      <p className="max-w-prose text-text-secondary">{message}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Button type="button" variant="outline" onClick={onRetry}>
          <RotateCcwIcon aria-hidden="true" />
          {retryLabel ?? t('actions.retry')}
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
