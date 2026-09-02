import { cn } from '../primitives/lib/utils';

export interface RouteProgressProps {
  /** Whether a route navigation is currently loading (`router.state
   * .isLoading` in `__root.tsx` — this component is router-free by
   * design, so the caller decides what "active" means). */
  active: boolean;
  /** `aria-label` for the progress bar — translated by the caller
   * (`nav.json`'s `routeProgress.label`). */
  label: string;
}

/**
 * [8.14.5]: thin top-of-viewport progress bar, the first thing a slow
 * navigation shows (well before `RoutePending`'s skeleton, which only
 * mounts once the pending component actually commits). Sits at `z-40`,
 * above #366's sticky header (`z-30`), so it reads as "the whole app is
 * busy" rather than being tucked under the chrome.
 *
 * Rendered unconditionally (not mounted/unmounted with `active`) so its
 * opacity fade-out is visible — an unmounted node has no transition to
 * play. `aria-hidden` mirrors `active` so assistive tech doesn't
 * announce a progress bar that's invisibly present between navigations.
 */
export function RouteProgress({ active, label }: RouteProgressProps) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-busy={active}
      aria-hidden={!active}
      // No `aria-valuenow` — the loader's duration is unknown ahead of
      // time, so this is an indeterminate progress indicator, which the
      // ARIA spec models as a `progressbar` with `aria-valuenow` simply
      // omitted rather than set to a placeholder number.
      className={cn(
        'pointer-events-none fixed inset-x-0 top-0 z-40 h-0.5 overflow-hidden bg-transparent',
        'transition-opacity duration-(--motion-duration-base) ease-(--motion-ease-standard)',
        active ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div className={cn('h-full w-1/3 bg-primary', active && 'route-progress-bar-active')} />
    </div>
  );
}
