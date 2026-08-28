/**
 * The surface primitive every screen was re-declaring inline: `rounded-lg
 * border border-border-subtle bg-card shadow-e1`. [5.2]'s portal landing alone uses
 * it six times (hero, one per child, recent payments), which is the point
 * past which the class string earns a component rather than a sixth copy.
 *
 * Deliberately *not* a shadcn-style `Card`/`CardHeader`/`CardTitle`/
 * `CardFooter` family. Nothing in this repo needs those slots today, and
 * a `CardTitle` would have to guess a heading level — the one thing
 * `useRouteFocus` (`../hooks/use-route-focus.ts`) cares about and the one
 * thing a generic component cannot know. Callers compose their own
 * `<h2>`/padding inside; this owns the surface and nothing else.
 *
 * `asChild` follows `button.tsx`'s Radix `Slot` precedent so a later
 * ticket (#25's per-child drill-down) can merge the surface onto a
 * router `Link` without wrapping an `<a>` in a `<div>`.
 */
import { Slot } from 'radix-ui';
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

export type CardProps = React.ComponentProps<'div'> & {
  /** Merge the card's styling onto the single child element instead of
   * rendering a `<div>` — e.g. a `Link` that should *be* the card. */
  asChild?: boolean;
};

export function Card({ className, asChild = false, ...props }: CardProps) {
  const Comp = asChild ? Slot.Root : 'div';

  return (
    <Comp
      data-slot="card"
      className={cn('rounded-lg border border-border-subtle bg-card shadow-e1', className)}
      {...props}
    />
  );
}
