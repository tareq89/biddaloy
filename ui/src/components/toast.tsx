/**
 * Wraps `sonner` rather than a vendored Radix primitive — this shadcn CLI/
 * registry version has no Radix-based `toast` recipe ("only available for
 * Base UI projects. Use the sonner component instead" is the CLI's own
 * message), and its `sonner` recipe pulls in `next-themes`, meaningless
 * outside a Next.js app — so `sonner` is installed directly instead of
 * through the CLI.
 *
 * `aria-live="polite"` and the announcement region are sonner's own
 * built-in behaviour (its `<section>` container), not something added
 * here. `closeButton` renders a real, focusable `<button aria-label="Close
 * toast">` per toast — keyboard-dismissible via Tab + Enter, on top of
 * sonner's own Escape-to-dismiss-the-focused-toast handling.
 */
import type { ComponentProps } from 'react';
import { Toaster as SonnerToaster, toast } from 'sonner';

export function Toaster(props: ComponentProps<typeof SonnerToaster>) {
  return <SonnerToaster richColors closeButton {...props} />;
}

export { toast };
