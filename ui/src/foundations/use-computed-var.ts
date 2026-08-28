import { useEffect, useState } from 'react';

/**
 * Reads a CSS custom property off `document.documentElement`, live, in the
 * browser Storybook actually renders in (not jsdom — see the note in
 * `ui/CONTRIBUTING.md`'s "Accessibility expectations" section on why
 * `color-contrast` is disabled there: no real paint/cascade engine).
 * `getComputedStyle` resolves the full `var(...)` chain — e.g.
 * `--color-bg: var(--color-neutral-900)` under `:root[data-theme="dark"]`
 * — down to the literal hex `tailwind.preset.ts` wrote, so callers never
 * re-type a value by hand; `colors.stories.tsx` feeds the result straight
 * into `contrastRatio`.
 *
 * The initial `useState` read happens synchronously during render, so a
 * story that never changes theme shows a correct value on first paint. A
 * `MutationObserver` on `data-theme` (rather than a second effect racing
 * `dark-decorator.tsx`'s own `useEffect`) is what keeps it live afterwards
 * — it fires whenever the attribute actually changes, regardless of which
 * effect wrote it or in what order React scheduled the two, which sidesteps
 * having to reason about `dark-decorator.tsx`'s and `preview.tsx`'s own
 * effect-ordering fight over the same attribute (see both files' comments).
 */
export function useComputedVar(name: string): string {
  const [value, setValue] = useState(() =>
    typeof document === 'undefined'
      ? ''
      : getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
  );

  useEffect(() => {
    const read = () =>
      setValue(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
    read();

    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, [name]);

  return value;
}
