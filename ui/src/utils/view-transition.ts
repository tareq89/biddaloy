/**
 * [8.14.5]: "is the route's view transition actually finished?" primitive.
 *
 * TanStack Router calls `document.startViewTransition()` itself (via
 * `defaultViewTransition: true` in `client-admin/src/main.tsx`), so the
 * `ViewTransition` object it gets back — and that object's `finished`
 * promise — is never reachable from this call site. Do NOT monkey-patch
 * `document.startViewTransition` to intercept it; that would silently
 * break if TanStack Router ever changes how it calls the API. Instead,
 * read the transition off the Web Animations API, which is what the
 * `::view-transition-*` pseudo-elements actually animate on
 * (`ui/src/styles/globals.css`'s `#main-content { view-transition-name:
 * app-main-content }` block is what gives them something to animate).
 *
 * `useRouteFocus` (`../hooks/use-route-focus.ts`) awaits this before
 * moving focus to the new page's `<h1>` — landing focus mid-transition,
 * while the outgoing/incoming snapshots are still layered on top of each
 * other, would both look wrong and scroll under the sticky header before
 * the real layout has replaced the frozen snapshot (see #366's
 * `scroll-margin-top` contract, which only applies to the *real* `<h1>`).
 */

/** Milliseconds after which focus moves regardless of whether a view
 * transition ever settles. A transition may never start at all
 * (unsupported browser, or a chrome-free route like `/login` that has no
 * `#main-content` to name) or may never resolve its `finished` promise in
 * some edge case — either way this must not be able to strand keyboard
 * focus indefinitely. */
export const VIEW_TRANSITION_FOCUS_TIMEOUT_MS = 500;

function isViewTransitionAnimation(animation: Animation): boolean {
  const pseudo = (animation.effect as KeyframeEffect | null)?.pseudoElement;
  return pseudo?.startsWith('::view-transition') ?? false;
}

/**
 * Resolves once every in-flight view-transition pseudo-element animation
 * has settled (or after {@link VIEW_TRANSITION_FOCUS_TIMEOUT_MS}, whichever
 * comes first). Returns `null` synchronously — instead of a promise — when
 * there is nothing to wait for, so callers can skip the microtask entirely
 * on the common "no active transition" path.
 *
 * Implementation notes:
 * - `document.getAnimations()` right after the DOM update returns `[]` —
 *   the pseudo-elements aren't created until the next animation frame, so
 *   a single `requestAnimationFrame` is load-bearing here, not
 *   incidental.
 * - After that rAF, filter to `::view-transition-*` animations only.
 *   Empty → nothing is running, resolve immediately. Non-empty →
 *   `Promise.allSettled` on their `finished` promises, then resolve.
 * - `allSettled`, not `all`: a view transition that gets skipped (e.g.
 *   `prefers-reduced-motion`, or another navigation interrupting this
 *   one) rejects its `finished` promise. A rejection must still let focus
 *   land — it must not leave the caller's `.then()` unresolved.
 */
export function waitForViewTransition(): Promise<void> | null {
  if (
    typeof document === 'undefined' ||
    typeof document.startViewTransition !== 'function' ||
    typeof document.getAnimations !== 'function'
  ) {
    return null;
  }

  return new Promise<void>((resolve) => {
    const timeoutId = setTimeout(resolve, VIEW_TRANSITION_FOCUS_TIMEOUT_MS);

    requestAnimationFrame(() => {
      const transitionAnimations = document.getAnimations().filter(isViewTransitionAnimation);

      if (transitionAnimations.length === 0) {
        clearTimeout(timeoutId);
        resolve();
        return;
      }

      void Promise.allSettled(transitionAnimations.map((animation) => animation.finished)).then(
        () => {
          clearTimeout(timeoutId);
          resolve();
        },
      );
    });
  });
}
