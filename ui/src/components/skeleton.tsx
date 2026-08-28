/**
 * `motion-reduce:animate-none` is Tailwind's built-in `@media
 * (prefers-reduced-motion: reduce)` variant — a user who has that OS
 * setting on gets a static placeholder, not a pulsing one.
 *
 * `bg-muted` is deliberately the only colour here. [8.13.3] (#344) moved
 * `--color-muted` off `--color-surface` and onto `neutral-100`, which is
 * exactly the "shimmer toward muted" the design contract §3.3 asks for —
 * so the shimmer needs no bespoke gradient, keyframe or colour of its own.
 *
 * ---
 *
 * `Skeleton` alone is a grey box; a grey box the wrong *shape* is what
 * makes a page jump when data lands. [8.13.11] adds three shared shapes
 * below so a route can stand in for what it is actually about to render
 * without hand-drawing a placeholder per screen:
 *
 *   SkeletonText      — paragraphs / generic stacked lines
 *   SkeletonTable     — a `Table`, built from the real `Table` markup so
 *                       row heights are identical by construction
 *   SkeletonFieldList — a `<dl>` of label/value pairs, the shape every
 *                       detail "overview" tab renders
 *
 * All three are decorative: they carry `aria-hidden="true"` by default so
 * a screen reader hears the caller's own "Loading…" live region rather
 * than a table of empty cells. A caller that already wraps them in an
 * `aria-hidden` container loses nothing by the duplication.
 */
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)}
      {...props}
    />
  );
}

export interface SkeletonTextProps extends React.ComponentProps<'div'> {
  /** How many lines the real content occupies. Defaults to 3 — the shape
   * the six route-level query-state helpers rendered by hand before this
   * component existed. */
  lines?: number;
}

/**
 * Stacked lines. The last one is short, because real prose does not end
 * flush with the margin and a stack of equal-length bars reads as a bar
 * chart rather than as text.
 */
export function SkeletonText({ lines = 3, className, ...props }: SkeletonTextProps) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-2', className)} {...props}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          // `cn` is tailwind-merge, so the trailing `w-2/3` replaces
          // `w-full` on the last line rather than fighting it in the
          // cascade.
          className={cn('h-6 w-full', index === lines - 1 && lines > 1 && 'w-2/3')}
        />
      ))}
    </div>
  );
}

export interface SkeletonTableProps extends React.ComponentProps<'table'> {
  rows?: number;
  columns?: number;
}

/**
 * A table-shaped placeholder.
 *
 * Built from this package's own `Table` parts rather than from divs with
 * hand-copied padding: the header is `h-10 px-2` and each cell is `p-2`
 * around `text-sm` *because `table.tsx` says so*, so a row here is exactly
 * as tall as the row that replaces it. That identity is the whole point —
 * a placeholder whose rows are 4px short of the real ones is a CLS
 * regression dressed up as a loading state (design contract's ≤ 0.1
 * budget).
 */
export function SkeletonTable({ rows = 4, columns = 4, ...props }: SkeletonTableProps) {
  const columnIndexes = Array.from({ length: columns }, (_, index) => index);
  return (
    <Table aria-hidden="true" {...props}>
      <TableHeader>
        <TableRow>
          {columnIndexes.map((column) => (
            <TableHead key={column}>
              <Skeleton className="h-4 w-20" />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }, (_, row) => (
          <TableRow key={row}>
            {columnIndexes.map((column) => (
              <TableCell key={column}>
                <Skeleton className="h-4 w-full" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export interface SkeletonFieldListProps extends React.ComponentProps<'div'> {
  /** Number of label/value pairs the real `<dl>` renders. */
  fields?: number;
}

/**
 * The label-over-value grid every detail "overview" tab renders — a
 * `text-sm` label above a body-size value, two columns on a phone and
 * four from `sm` up, matching `students/-detail/overview-tab.tsx`'s own
 * `grid-cols-2 … sm:grid-cols-4`.
 *
 * A plain `<div>` grid, not a real `<dl>`: an empty `<dt>`/`<dd>` pair
 * carries no meaning to assistive tech and the geometry is what matters
 * here, so there is nothing to gain from the semantic elements and one
 * more empty-landmark shape to explain to axe.
 */
export function SkeletonFieldList({ fields = 4, className, ...props }: SkeletonFieldListProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4', className)}
      {...props}
    >
      {Array.from({ length: fields }, (_, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-32" />
        </div>
      ))}
    </div>
  );
}
