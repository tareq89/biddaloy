/**
 * The one wrapper around `primitives/popover` — same "vendored primitive
 * stays internal, SPAs only ever import the wrapper" boundary `menu.tsx`
 * enforces for `primitives/dropdown-menu`. Deliberately not `Menu`'s
 * roving-tabindex/arrow-key ARIA menu pattern: [8.9.8]'s notification
 * panel is a list of read/unread items to Tab through, not a list of
 * commands, so a plain popover with ordinary Tab-based focus is the
 * better fit (Radix's own focus-trap-on-open/focus-return-on-close is
 * unchanged either way — the same primitive family `dialog.tsx` already
 * exercises end to end).
 */
import * as React from 'react';

import {
  Popover as PopoverPrimitive,
  PopoverAnchor as PopoverAnchorPrimitive,
  PopoverContent as PopoverContentPrimitive,
  PopoverDescription as PopoverDescriptionPrimitive,
  PopoverHeader as PopoverHeaderPrimitive,
  PopoverTitle as PopoverTitlePrimitive,
  PopoverTrigger as PopoverTriggerPrimitive,
} from '../primitives/popover';

export type PopoverProps = React.ComponentProps<typeof PopoverPrimitive>;
export type PopoverTriggerProps = React.ComponentProps<typeof PopoverTriggerPrimitive>;
export type PopoverContentProps = React.ComponentProps<typeof PopoverContentPrimitive>;
export type PopoverAnchorProps = React.ComponentProps<typeof PopoverAnchorPrimitive>;
export type PopoverHeaderProps = React.ComponentProps<typeof PopoverHeaderPrimitive>;
export type PopoverTitleProps = React.ComponentProps<typeof PopoverTitlePrimitive>;
export type PopoverDescriptionProps = React.ComponentProps<typeof PopoverDescriptionPrimitive>;

export function Popover(props: PopoverProps) {
  return <PopoverPrimitive {...props} />;
}

export function PopoverTrigger(props: PopoverTriggerProps) {
  return <PopoverTriggerPrimitive {...props} />;
}

export function PopoverContent(props: PopoverContentProps) {
  return <PopoverContentPrimitive {...props} />;
}

export function PopoverAnchor(props: PopoverAnchorProps) {
  return <PopoverAnchorPrimitive {...props} />;
}

export function PopoverHeader(props: PopoverHeaderProps) {
  return <PopoverHeaderPrimitive {...props} />;
}

export function PopoverTitle(props: PopoverTitleProps) {
  return <PopoverTitlePrimitive {...props} />;
}

export function PopoverDescription(props: PopoverDescriptionProps) {
  return <PopoverDescriptionPrimitive {...props} />;
}
