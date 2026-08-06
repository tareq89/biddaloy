/**
 * `motion-reduce:animate-none` is Tailwind's built-in `@media
 * (prefers-reduced-motion: reduce)` variant — a user who has that OS
 * setting on gets a static placeholder, not a pulsing one.
 */
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)}
      {...props}
    />
  );
}
