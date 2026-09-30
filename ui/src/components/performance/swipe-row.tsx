import type { ReactNode } from 'react';

/**
 * [28.x] Phone: horizontal scroll-snap row (D23). Desktop (md+): plain grid.
 * The scroller is focusable + labelled so keyboard users can arrow-scroll it
 * (WCAG 2.1.1 / axe `scrollable-region-focusable`).
 */
export interface SwipeRowProps {
  /** Accessible name, already translated. */
  label: string;
  children: ReactNode;
}

export function SwipeRow({ label, children }: SwipeRowProps) {
  return (
    <div
      role="region"
      aria-label={label}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable region must be keyboard reachable
      tabIndex={0}
      className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 focus-visible:outline-2 focus-visible:outline-ring md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-3 [&>*]:w-[85%] [&>*]:shrink-0 [&>*]:snap-center md:[&>*]:w-auto"
    >
      {children}
    </div>
  );
}
