import { cn } from '../../primitives/lib/utils';

import { BG, type ChartColor } from './chart-utils';

/**
 * [169.1-04] One horizontal bar split into labelled parts (by method,
 * ageing). CSS only, no chart library (D27). The accessible text never
 * depends on colour. Presentational; strings arrive formatted.
 */
export type StackedBarColor = ChartColor;

export interface StackedBarSegment {
  id: string;
  label: string;
  value: number;
  valueLabel: string;
  detail?: string;
  color: StackedBarColor;
}

export interface StackedBarProps {
  label: string;
  segments: StackedBarSegment[];
  /** Default true. */
  legend?: boolean;
  /** 6px / 20px. Default md. */
  size?: 'sm' | 'md';
  className?: string;
}

export function StackedBar({
  label,
  segments,
  legend = true,
  size = 'md',
  className,
}: StackedBarProps) {
  const drawn = segments.filter((s) => s.value > 0);
  const name = `${label}: ${segments.map((s) => `${s.label} ${s.valueLabel}`).join(', ')}`;
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div
        role="img"
        aria-label={name}
        data-testid="stacked-bar-track"
        className={cn(
          'flex w-full gap-0.5 overflow-hidden rounded-full',
          size === 'sm' ? 'h-1.5' : 'h-5',
          drawn.length === 0 && 'bg-muted',
        )}
      >
        {drawn.map((s) => (
          <div
            key={s.id}
            data-testid="stacked-bar-segment"
            title={`${s.label}: ${s.valueLabel}`}
            className={cn('h-full min-w-0', BG[s.color])}
            style={{ flexGrow: s.value }}
          />
        ))}
      </div>
      {legend ? (
        <ul className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-3">
          {segments.map((s) => (
            <li key={s.id} className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5 text-caption text-text-secondary">
                <span
                  aria-hidden="true"
                  className={cn('size-2 shrink-0 rounded-full', BG[s.color])}
                />
                <span className="truncate">{s.label}</span>
              </span>
              <span className="font-semibold tabular-nums">{s.valueLabel}</span>
              {s.detail ? (
                <span className="text-caption text-text-secondary">{s.detail}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
