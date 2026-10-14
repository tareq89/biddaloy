import { cn } from '../../primitives/lib/utils';

import { BG, type ChartColor } from './chart-utils';

export interface MeterProps {
  /** Accessible name. */
  label: string;
  value: number;
  max: number;
  /** "৭০%" or "৪ / ১২": aria-valuetext and visible start label. */
  valueText: string;
  /** "লক্ষ্য ৳১২,১০,০০০" or "মোট ১২". */
  endText?: string;
  marker?: { value: number; label: string };
  color?: ChartColor;
  size?: 'sm' | 'md';
  /** false inside a StatTile. */
  showText?: boolean;
  className?: string;
}

const pct = (v: number, max: number) => (max > 0 ? Math.min(100, Math.max(0, (v / max) * 100)) : 0);

export function Meter({
  label,
  value,
  max,
  valueText,
  endText,
  marker,
  color = 'primary',
  size = 'md',
  showText = true,
  className,
}: MeterProps) {
  return (
    <div className={cn('flex w-full flex-col gap-1', className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(max, Math.max(0, value))}
        aria-valuetext={marker ? `${valueText}, ${marker.label}` : valueText}
        className="relative"
      >
        <div
          className={cn(
            'w-full overflow-hidden rounded-full bg-muted',
            size === 'sm' ? 'h-1.5' : 'h-2',
          )}
        >
          <div
            data-meter-fill
            className={cn('h-full rounded-full', BG[color])}
            style={{ width: `${pct(value, max)}%` }}
          />
        </div>
        {marker ? (
          <span
            data-meter-marker
            aria-hidden="true"
            className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-text-primary"
            style={{ left: `${pct(marker.value, max)}%` }}
          />
        ) : null}
      </div>
      {showText ? (
        <>
          <div className="flex items-baseline justify-between gap-2 text-caption text-text-secondary">
            <span className="font-semibold tabular-nums text-text-primary">{valueText}</span>
            {endText ? <span className="tabular-nums">{endText}</span> : null}
          </div>
          {marker ? (
            <p className="text-caption text-text-secondary">
              <span aria-hidden="true">| </span>
              {marker.label}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
