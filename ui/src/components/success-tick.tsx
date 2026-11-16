/**
 * [3329.1.04] A circle that draws itself, then a tick, over
 * `--motion-duration-confirm` (470 ms): the circle takes the first 60%, the
 * tick the last 40%. Wrapped in a `role="status"` live region so the success
 * is announced, not just seen.
 *
 * Motion is a plain CSS transition on `stroke-dashoffset` driven by the
 * duration token, so `prefers-reduced-motion` needs no code here: the token is
 * 0ms and the global rule collapses the transition, which lands on the final
 * state at once (design contract §7).
 *
 * The label is `states:success.title` (D9).
 */
import * as React from 'react';

import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

export interface SuccessTickProps {
  /** Announced to screen readers; defaults to the translated success title. */
  label?: string;
  className?: string;
}

const CIRCLE_SHARE = 0.6;
const timing = (share: number) => `calc(var(--motion-duration-confirm) * ${share})`;

export function SuccessTick({ label, className }: SuccessTickProps) {
  const { t } = useTranslation('states');
  const [drawn, setDrawn] = React.useState(false);
  // One frame after mount so the browser paints the undrawn state first.
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // `pathLength=1` makes dash length 1 mean "the whole path", whatever its size.
  const stroke = (extra: React.CSSProperties): React.CSSProperties => ({
    strokeDasharray: 1,
    strokeDashoffset: drawn ? 0 : 1,
    transitionProperty: 'stroke-dashoffset',
    transitionTimingFunction: 'var(--motion-ease-standard)',
    ...extra,
  });

  return (
    <span role="status" className={cn('inline-flex items-center gap-2', className)}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="size-10 stroke-status-paid-fg"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          pathLength={1}
          style={stroke({ transitionDuration: timing(CIRCLE_SHARE) })}
        />
        <path
          d="M7.5 12.5l3 3 6-6.5"
          pathLength={1}
          style={stroke({
            transitionDuration: timing(1 - CIRCLE_SHARE),
            transitionDelay: timing(CIRCLE_SHARE),
          })}
        />
      </svg>
      <span className="sr-only">{label ?? t('success.title')}</span>
    </span>
  );
}
