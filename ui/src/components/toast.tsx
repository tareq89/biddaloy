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
 *
 * [8.14.3]: `mobileOffset` (sonner 2.x) pushes the toast stack clear of the
 * gesture-nav home indicator on a narrow viewport, the same
 * `--safe-area-bottom` token (`ui/src/styles/globals.css`) `BottomNav` uses.
 * `env()` resolves to `0px` outside an installed, `viewport-fit=cover` PWA,
 * so the `1rem` base offset is all a normal browser tab ever sees. This is
 * a *default*, not a forced value — `{...props}` is applied last so a
 * caller-supplied `mobileOffset` still wins. Scope note: this clears the
 * home indicator only; toasts can still overlap the bottom nav bar itself,
 * which is a deliberate non-goal for [8.14.3].
 */
import type { ComponentProps } from 'react';
import { Toaster as SonnerToaster, toast } from 'sonner';

export function Toaster(props: ComponentProps<typeof SonnerToaster>) {
  return (
    <SonnerToaster
      richColors
      closeButton
      mobileOffset={{ bottom: 'calc(1rem + var(--safe-area-bottom, 0px))' }}
      {...props}
    />
  );
}

export { toast };
