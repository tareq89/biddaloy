import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Vendored — the standard shadcn/ui `cn()` helper. Regenerate, don't edit. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
