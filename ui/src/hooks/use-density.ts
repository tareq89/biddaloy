import { useEffect } from 'react';

/**
 * Density mode names from the design contract (§6). `compact` is the staff
 * default and is expressed by ABSENCE — no attribute, no `--control-h`, so
 * every size class resolves its own per-variant fallback.
 */
export type DensityMode = 'comfortable';

/**
 * Applies a density mode for as long as the calling route is mounted, by
 * setting `data-density` on **`document.documentElement`**.
 *
 * ## Why the document element and not a wrapper `<div>`
 *
 * `--control-h` inherits down the DOM tree, so a wrapper is enough for
 * anything rendered inside it. It is NOT enough for anything rendered through
 * a React portal: Radix mounts `Dialog`, `Select`, `DropdownMenu`, `Popover`
 * and `Tooltip` content into `document.body` (see
 * `primitives/dialog.tsx` — `DialogPrimitive.Portal` with no `container`), so
 * that content is a sibling of the app root, not a descendant of any wrapper.
 *
 * On the guardian surface that is not a theoretical gap, it is the main
 * event:
 *
 * - `components/app-shell.tsx`'s mobile off-canvas navigation IS a
 *   `DialogContent`. Its close button (`size="icon-sm"`) and every nav link
 *   render in the portal, so under a wrapper they stayed 28 px on the exact
 *   360 px phone the 44 px target-size rule exists for.
 * - `components/locale-switcher.tsx` on `/login` and `/select-school` is a
 *   `DropdownMenu`: the trigger grew to 44 px inside the wrapper while its
 *   menu items, portalled out, did not.
 *
 * `document.documentElement` is an ancestor of `document.body`, so portalled
 * content inherits from it like everything else.
 *
 * ## Why an effect with restore rather than a static attribute
 *
 * The attribute is route-scoped state on a node the route does not own, which
 * is the same problem `.storybook/dark-decorator.tsx` solves for
 * `data-theme`: set on mount, restore the PREVIOUS value on unmount, so
 * navigating away from `/portal` back to a staff route (browser Back
 * included) leaves the document exactly as it was found. Writing a literal
 * attribute in `index.html` or clobbering it to `undefined` on cleanup would
 * both leak comfortable density into the staff shell.
 *
 * React flushes every unmounting effect's cleanup before any mounting
 * effect's setup in the same commit, so a `/login` -> `/portal` navigation
 * restores then re-sets rather than racing.
 */
export function useDensity(mode: DensityMode): void {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.density;
    root.dataset.density = mode;

    return () => {
      if (previous === undefined) delete root.dataset.density;
      else root.dataset.density = previous;
    };
  }, [mode]);
}
