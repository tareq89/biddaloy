/**
 * The one wrapper around `primitives/tooltip`. Radix's `Tooltip` already
 * follows the WAI-ARIA tooltip pattern: shows on hover *and* keyboard focus
 * (not hover-only, which would make it invisible to keyboard users), hides
 * on `Esc`/blur. `TooltipProvider` must wrap the app once (or once per
 * story, see `tooltip.stories.tsx`) — it isn't included in this wrapper's
 * own `Tooltip` because Radix requires exactly one ancestor `Provider` for
 * the whole tree, not one per tooltip instance.
 */
import * as React from 'react';

import { cn } from '../primitives/lib/utils';
import {
  Tooltip as TooltipPrimitive,
  TooltipContent as TooltipContentPrimitive,
  TooltipProvider as TooltipProviderPrimitive,
  TooltipTrigger as TooltipTriggerPrimitive,
} from '../primitives/tooltip';

export type TooltipProps = React.ComponentProps<typeof TooltipPrimitive>;
export type TooltipTriggerProps = React.ComponentProps<typeof TooltipTriggerPrimitive>;
export type TooltipContentProps = React.ComponentProps<typeof TooltipContentPrimitive>;
export type TooltipProviderProps = React.ComponentProps<typeof TooltipProviderPrimitive>;

export function TooltipProvider(props: TooltipProviderProps) {
  return <TooltipProviderPrimitive {...props} />;
}

export function Tooltip(props: TooltipProps) {
  return <TooltipPrimitive {...props} />;
}

export function TooltipTrigger(props: TooltipTriggerProps) {
  return <TooltipTriggerPrimitive {...props} />;
}

export function TooltipContent({ className, sideOffset = 4, ...props }: TooltipContentProps) {
  return (
    <TooltipContentPrimitive
      sideOffset={sideOffset}
      className={cn('rounded-md px-2 py-1 text-caption whitespace-nowrap shadow-e2', className)}
      {...props}
    />
  );
}
