/**
 * `explanation` and `action` are both required, non-optional props —
 * an empty state that only says "No data" is a dead end, one that says "No
 * fee structures yet. Create one to start generating monthly fees" teaches
 * the product. Omitting either is a type error, not a lint warning:
 * there is no honest default for either field.
 *
 * `title` renders as an `<h1>` — [8.9.7]: every route in the app is
 * expected to have exactly one page-level heading for `useRouteFocus` to
 * find and focus after navigation, and today `EmptyState` is what a
 * still-a-placeholder route (`/`, `/fees`, the 404 page) renders as its
 * entire content. Same visual size as before, only the element changed.
 *
 * ---
 *
 * [8.13.11] added `kind`, and it is the load-bearing distinction on this
 * component. "You have not created anything yet" and "your filter matched
 * nothing" are different facts about the world and want different fixes,
 * but before this prop they rendered identically, so the only signal a
 * user got was whatever the caller happened to write in `explanation`.
 *
 *   kind="empty"      — nothing exists yet. Dashed outline: a container
 *                       waiting to be filled. The action creates the first
 *                       one.
 *   kind="no-results" — things exist, this view just does not show them.
 *                       Solid outline (the container is real and populated
 *                       elsewhere) and a brand-tinted icon well, because a
 *                       filter is something the user switched on and can
 *                       switch off. The action clears the filter.
 *
 * `secondaryAction` exists for the same reason: "no results" usually has
 * two honest next moves (clear the filter, or create one anyway), and
 * before this there was room for exactly one. Both additions are optional
 * with the previous behaviour as the default, so every existing call site
 * keeps type-checking and rendering unchanged.
 *
 * Colours are existing, contract-verified pairs only. The `no-results`
 * well is `bg-secondary`/`text-secondary-foreground`, which resolve to
 * brand-50/brand-700 — 7.89:1, already in `CONTRAST_PAIRS` as 'brand-700
 * on brand-50 (selected nav item)'. The `empty` well is
 * `bg-muted`/`text-muted-foreground` — neutral-100/neutral-600, 6.92:1,
 * already there as 'muted-foreground on muted'. In dark mode both wells
 * follow their tokens: `muted` returns to the elevated surface (9.85:1
 * against `text-secondary`) and `secondary` to the same surface with
 * brand-400 text (5.46:1, 'dark brand text on dark surface'). No new pair
 * is introduced, so `CONTRAST_PAIRS` needs no new row.
 *
 * ---
 *
 * This file's border/elevation/colour choices are the canonical reference
 * for the whole empty/loading/error family — `ErrorState`,
 * `RouteStatusState`, and `AccessDeniedState` point back here rather than
 * re-deriving the same comparison, so a new member only needs one table
 * updated, not every file:
 *
 *   component                border    elevation    icon well
 *   EmptyState (empty)       dashed    none         bg-muted (neutral)
 *   EmptyState (no-results)  solid     none         bg-secondary (brand)
 *   RouteStatusState         dashed    none         bg-muted (neutral)
 *   AccessDeniedState        dashed    none         bg-muted (neutral)
 *   ErrorState                solid    shadow-e1    bg-destructive/10
 *
 * Solid + elevated is reserved for `ErrorState`, the one member that
 * reports an actual fault — everything else stays flat, so the
 * difference survives a glance on a phone without relying on copy alone.
 */
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

import { Button } from './button';

/** See the note above on why this is a distinct state and not just
 * different copy. */
export type EmptyStateKind = 'empty' | 'no-results';

export interface EmptyStateProps {
  title: string;
  explanation: string;
  action: { label: string; onClick: () => void };
  /** A second, lower-emphasis way out. Rendered as a `ghost` button beside
   * `action`, mirroring `ErrorState`'s `onHome`. Optional: most "nothing
   * yet" states have exactly one honest next move. */
  secondaryAction?: { label: string; onClick: () => void };
  /** Defaults to `'empty'` — the behaviour every caller written before
   * [8.13.11] already had. */
  kind?: EmptyStateKind;
  icon?: React.ReactNode;
}

export function EmptyState({
  title,
  explanation,
  action,
  secondaryAction,
  kind = 'empty',
  icon,
}: EmptyStateProps) {
  const noResults = kind === 'no-results';
  return (
    <div
      data-slot="empty-state"
      data-kind={kind}
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border border-border-subtle bg-card p-8 text-center',
        !noResults && 'border-dashed',
      )}
    >
      {icon && (
        // The `[&_svg]:size-8` stays on the wrapper (rather than moving to
        // the icon itself) so the caller still cannot pass an icon at the
        // wrong size — the well is new, that contract is not.
        <div
          className={cn(
            'mb-1 flex size-14 items-center justify-center rounded-full [&_svg]:size-8',
            noResults ? 'bg-secondary text-secondary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          {icon}
        </div>
      )}
      <h1 className="font-medium">{title}</h1>
      <p className="max-w-prose text-sm text-muted-foreground">{explanation}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Button type="button" onClick={action.onClick}>
          {action.label}
        </Button>
        {secondaryAction && (
          <Button type="button" variant="ghost" onClick={secondaryAction.onClick}>
            {secondaryAction.label}
          </Button>
        )}
      </div>
    </div>
  );
}
