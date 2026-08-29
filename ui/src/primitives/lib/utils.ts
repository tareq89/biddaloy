import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Hand-ported, not CLI-generated — `shadcn add` for this CLI version/base
 * doesn't create a `lib/utils.ts` on its own. This is upstream shadcn/ui's
 * standard `cn()` implementation, with one deliberate deviation described
 * below. Keep the rest matching upstream if that implementation ever changes;
 * there's no `--overwrite` to do it for you here.
 *
 * **The deviation: teach tailwind-merge the elevation scale.**
 *
 * [8.13.9] replaced Tailwind's built-in shadow sizes with the token-backed
 * `shadow-e1`/`shadow-e2`/`shadow-e3` utilities (§5 of
 * `docs/architecture/09-design-direction.md`). Stock tailwind-merge has never
 * heard those names. It parses `shadow-<unknown>` as a *shadow colour*, not a
 * shadow size, so it files `shadow-e1` in the `shadow-color` group while
 * `shadow-none` and `shadow-md` stay in the `shadow` group. Two different
 * groups do not conflict, so nothing gets dropped:
 *
 * ```
 * twMerge('shadow-e1', 'shadow-none') // -> 'shadow-e1 shadow-none'  (both!)
 * twMerge('shadow-e1', 'shadow-md')   // -> 'shadow-e1 shadow-md'    (both!)
 * ```
 *
 * That is a real public-behaviour bug in every primitive that bakes an
 * elevation into its base class string and lets callers override it —
 * `<Card className="shadow-none">` only *looked* flat because `.shadow-none`
 * happens to be emitted after `.shadow-e1` in the compiled stylesheet. The
 * caller's override was silently depending on source order, and would flip the
 * day Tailwind reordered its output. (`shadow-e1 shadow-e3` collapsed
 * correctly by accident: both land in `shadow-color`, so last-one-wins.)
 *
 * Registering `e1`/`e2`/`e3` as members of the real `shadow` group fixes it
 * once for every component that uses `cn`, rather than per call site. Colour
 * modifiers are untouched: `cn('shadow-e1', 'shadow-brand-600')` still keeps
 * both, because a size and a colour genuinely do not conflict.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: [{ shadow: ['e1', 'e2', 'e3'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
