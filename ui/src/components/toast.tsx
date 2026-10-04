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
 * [8.14.3]/[31.2.8b]: toasts sit clear of the gesture-nav home indicator
 * (`--safe-area-bottom`, `ui/src/styles/globals.css`) and, below `md`, above
 * the fixed 4rem bottom bar (5rem = bar + 1rem gap). Sonner's own "mobile"
 * switch is 600px but the bar shows below 768px, so the breakpoint is read
 * here. ponytail: guest pages below `md` (no bar) get the same lift; key it
 * off a real "bar mounted" signal only if that looks wrong. These are
 * defaults: `{...props}` is applied last so a caller-supplied offset wins.
 */
import type { ComponentProps } from 'react';
import * as React from 'react';
import { Toaster as SonnerToaster, toast } from 'sonner';

const BELOW_MD = '(max-width: 47.99rem)';

function subscribe(cb: () => void) {
  if (typeof matchMedia !== 'function') return () => {};
  const m = matchMedia(BELOW_MD);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}

export function Toaster(props: ComponentProps<typeof SonnerToaster>) {
  const belowMd = React.useSyncExternalStore(
    subscribe,
    () => typeof matchMedia === 'function' && matchMedia(BELOW_MD).matches,
    () => false,
  );
  const bottom = belowMd ? 'calc(5rem + var(--safe-area-bottom, 0px))' : undefined;

  return (
    <SonnerToaster
      richColors
      closeButton
      {...(bottom ? { offset: { bottom } } : {})}
      mobileOffset={{ bottom: bottom ?? 'calc(1rem + var(--safe-area-bottom, 0px))' }}
      {...props}
    />
  );
}

export { toast };
