/**
 * The one wrapper around `primitives/dialog`. Focus trap, `Esc`-to-close,
 * and returning focus to the trigger on close are Radix's own behaviour —
 * this wrapper doesn't reimplement any of it, just re-exports through the
 * package boundary so no SPA reaches `radix-ui` directly. `dialog.test.tsx`
 * exercises all three end to end rather than trusting the primitive, since
 * "Radix does this" and "our composition of Radix still does this" are
 * different claims — the close button lives inside `DialogContent`
 * (`primitives/dialog.tsx`), and a wrapper that changed how children are
 * passed could silently break the trap.
 *
 * `DialogTitle` is required by Radix's own a11y contract (it warns loudly
 * in dev if a `DialogContent` has none) — this wrapper doesn't relax that;
 * every dialog needs a real title, use `VisuallyHidden` from Radix directly
 * in the rare case it shouldn't be visible.
 */
import * as React from 'react';

import {
  Dialog as DialogPrimitive,
  DialogClose as DialogClosePrimitive,
  DialogContent as DialogContentPrimitive,
  DialogDescription as DialogDescriptionPrimitive,
  DialogFooter as DialogFooterPrimitive,
  DialogHeader as DialogHeaderPrimitive,
  DialogTitle as DialogTitlePrimitive,
  DialogTrigger as DialogTriggerPrimitive,
} from '../primitives/dialog';

export type DialogProps = React.ComponentProps<typeof DialogPrimitive>;
export type DialogTriggerProps = React.ComponentProps<typeof DialogTriggerPrimitive>;
export type DialogContentProps = React.ComponentProps<typeof DialogContentPrimitive>;
export type DialogHeaderProps = React.ComponentProps<typeof DialogHeaderPrimitive>;
export type DialogFooterProps = React.ComponentProps<typeof DialogFooterPrimitive>;
export type DialogTitleProps = React.ComponentProps<typeof DialogTitlePrimitive>;
export type DialogDescriptionProps = React.ComponentProps<typeof DialogDescriptionPrimitive>;
export type DialogCloseProps = React.ComponentProps<typeof DialogClosePrimitive>;

export function Dialog(props: DialogProps) {
  return <DialogPrimitive {...props} />;
}

export function DialogTrigger(props: DialogTriggerProps) {
  return <DialogTriggerPrimitive {...props} />;
}

export function DialogContent(props: DialogContentProps) {
  return <DialogContentPrimitive {...props} />;
}

export function DialogHeader(props: DialogHeaderProps) {
  return <DialogHeaderPrimitive {...props} />;
}

export function DialogFooter(props: DialogFooterProps) {
  return <DialogFooterPrimitive {...props} />;
}

export function DialogTitle(props: DialogTitleProps) {
  return <DialogTitlePrimitive {...props} />;
}

export function DialogDescription(props: DialogDescriptionProps) {
  return <DialogDescriptionPrimitive {...props} />;
}

export function DialogClose(props: DialogCloseProps) {
  return <DialogClosePrimitive {...props} />;
}
