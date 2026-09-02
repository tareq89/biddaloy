/**
 * [8.14.17]'s shared refusal state — what `RequirePermission`
 * (`ui/src/routes/require-permission.tsx`) renders **in place** of a
 * route's content when the active role holds the route but not the
 * permission it needs. Three staff routes hand-rolled this exact shape
 * before this ticket (`/settings`, `/audit-logs`, `/fees/generate`); this
 * component is the one place that pattern now lives.
 *
 * Sibling of `EmptyState`/`RouteStatusState`, not a variant of either —
 * see `empty-state.tsx`'s file comment for the canonical
 * border/elevation/icon-well table this belongs in:
 *
 *   component                border    elevation    icon well
 *   EmptyState (empty)       dashed    none         bg-muted (neutral)
 *   EmptyState (no-results)  solid     none         bg-secondary (brand)
 *   RouteStatusState         dashed    none         bg-muted (neutral)
 *   AccessDeniedState        dashed    none         bg-muted (neutral)
 *   ErrorState                solid    shadow-e1    bg-destructive/10
 *
 * `role="status"`, not `role="alert"` — a refused permission is not an
 * application fault, exactly the reasoning `RouteStatusState` documents
 * for its own two situations.
 *
 * It supplies its own copy via `useTranslation('common')` rather than
 * requiring the caller to prop-drill English strings the way `EmptyState`
 * does: every route that renders this says the same thing ("you don't
 * have access"), so one translated default beats 27 call sites each
 * repeating the same translated strings themselves. `title` /
 * `explanation` / `actionLabel` exist only as *optional* overrides for
 * the rare route (`/audit-logs`) that wants more specific copy.
 *
 * Router-agnostic, like `RouteStatusState`'s `onHome`: this component
 * never navigates on its own, it calls the caller-supplied `onAction`.
 */
import { LockIcon } from 'lucide-react';

import { useTranslation } from '../i18n';

import { Button } from './button';

export interface AccessDeniedStateProps {
  /** Renders as an `<h1>` — [8.9.7]: `useRouteFocus` looks for exactly
   * one page-level heading per route, and when this replaces a route's
   * whole output it is that route's heading. Defaults to
   * `common:accessDenied.title`. */
  title?: string;
  /** Defaults to `common:accessDenied.explanation`. */
  explanation?: string;
  /** Defaults to `common:accessDenied.action`. */
  actionLabel?: string;
  /** Optional escape hatch. Omit it (the embedded/no-router case) and no
   * button renders at all — same convention as `RouteStatusState.onHome`. */
  onAction?: () => void;
}

export function AccessDeniedState({
  title,
  explanation,
  actionLabel,
  onAction,
}: AccessDeniedStateProps) {
  const { t } = useTranslation('common');

  return (
    <div
      role="status"
      data-slot="access-denied-state"
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-subtle bg-card p-8 text-center"
    >
      <div className="mb-1 flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-8">
        <LockIcon aria-hidden="true" />
      </div>
      <h1 className="font-medium">{title ?? t('accessDenied.title')}</h1>
      <p className="max-w-prose text-sm text-muted-foreground">
        {explanation ?? t('accessDenied.explanation')}
      </p>
      {onAction && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="outline" onClick={onAction}>
            {actionLabel ?? t('accessDenied.action')}
          </Button>
        </div>
      )}
    </div>
  );
}
