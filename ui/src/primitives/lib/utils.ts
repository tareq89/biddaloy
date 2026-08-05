import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Hand-ported, not CLI-generated — `shadcn add` for this CLI version/base
 * doesn't create a `lib/utils.ts` on its own. This is upstream shadcn/ui's
 * standard `cn()` implementation, copied verbatim so generated primitives
 * that expect `@/primitives/lib/utils` resolve correctly. Keep it matching
 * upstream if that implementation ever changes; there's no `--overwrite` to
 * do it for you here. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
