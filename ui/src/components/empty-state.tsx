/**
 * `explanation` is a required prop, and `action` is required unless the
 * viewer lacks permission to take it (then omit it) —
 * an empty state that only says "No data" is a dead end, one that says "No
 * fee structures yet. Create one to start generating monthly fees" teaches
 * the product. There is no honest default for either field.
 *
 * `title` renders as an `<h2>` by default — a page with a `PageHeader`
 * already owns the one `<h1>` ([8.9.7]: `useRouteFocus` expects exactly one
 * per route). A whole-route placeholder (the 404 page) that has no
 * `PageHeader` passes `headingLevel={1}` (C17).
 *
 * ---
 *
 * [8.13.11] added `kind`, and it is the load-bearing distinction on this
 * component. "You have not created anything yet" and "your filter matched
 * nothing" are different facts about the world and want different fixes,
 * but before this prop they rendered identically, so the only signal a
 * user got was whatever the caller happened to write in `explanation`.
 *
 *   kind="empty"      — nothing exists yet. The action creates the first
 *                       one.
 *   kind="no-results" — things exist, this view just does not show them.
 *                       Brand-tinted icon well, because a filter is
 *                       something the user switched on and can switch off.
 *                       The action clears the filter.
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
 * This file's card look is the canonical reference for the whole
 * empty/error/route-status family — `ErrorState`, `RouteStatusState`, and
 * `AccessDeniedState` point back here. All four are now the same card
 * (`rounded-lg border-border-subtle bg-surface shadow-e1`); they differ
 * only by icon-well tone and role:
 *
 *   component                role     icon well
 *   EmptyState (empty)       —        bg-muted (neutral)
 *   EmptyState (no-results)  —        bg-secondary (brand)
 *   RouteStatusState         status   bg-muted (neutral)
 *   AccessDeniedState        status   bg-muted (neutral)
 *   ErrorState               alert    bg-status-overdue-bg
 *
 * The one filled primary per view belongs to the page header (D29), so the
 * action here is an outline button.
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
  /** Optional so a caller can withhold the primary next move from a viewer
   * who lacks the permission to take it. */
  action?: { label: string; onClick: () => void };
  /** A second, lower-emphasis way out. Rendered as a `ghost` button beside
   * `action`, mirroring `ErrorState`'s `onHome`. Optional: most "nothing
   * yet" states have exactly one honest next move. */
  secondaryAction?: { label: string; onClick: () => void };
  /** Defaults to `'empty'` — the behaviour every caller written before
   * [8.13.11] already had. */
  kind?: EmptyStateKind;
  icon?: React.ReactNode;
  /** Defaults to `2`: a page with a `PageHeader` already owns the `<h1>`.
   * A whole-route placeholder passes `1` (C17). */
  headingLevel?: 1 | 2 | 3;
}

export function EmptyState({
  title,
  explanation,
  action,
  secondaryAction,
  kind = 'empty',
  icon,
  headingLevel = 2,
}: EmptyStateProps) {
  const Heading: 'h1' | 'h2' | 'h3' = headingLevel === 1 ? 'h1' : headingLevel === 3 ? 'h3' : 'h2';
  const noResults = kind === 'no-results';
  return (
    <div
      data-slot="empty-state"
      data-kind={kind}
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border border-border-subtle bg-surface px-4 py-10 text-center shadow-e1',
      )}
    >
      {icon && (
        // The `[&_svg]:size-6` stays on the wrapper (rather than moving to
        // the icon itself) so the caller cannot pass an icon at the wrong size.
        <div
          className={cn(
            'flex size-12 items-center justify-center rounded-full [&_svg]:size-6',
            noResults ? 'bg-secondary text-secondary-foreground' : 'bg-muted text-text-secondary',
          )}
        >
          {icon}
        </div>
      )}
      <Heading className="text-h3">{title}</Heading>
      <p className="max-w-prose text-text-secondary">{explanation}</p>
      {(action || secondaryAction) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {action && (
            <Button type="button" variant="outline" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button type="button" variant="ghost" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
