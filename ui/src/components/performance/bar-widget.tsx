import { cn } from '../../primitives/lib/utils';
import { Card } from '../card';
import { Skeleton } from '../skeleton';

/**
 * [28.x] Labelled horizontal bars (CSS only, no chart library — D24). Each
 * bar carries its value as text, so meaning is never colour alone. Pure
 * presentational; strings arrive translated/formatted.
 */
export interface BarWidgetBar {
  label: string;
  /** 0..max, drives the bar width. */
  value: number;
  /** Already formatted text shown beside the bar, e.g. "82%". */
  valueLabel: string;
  /** Bold label; with `emphasis="highlighted"` also the primary fill. */
  highlight?: boolean;
  /** Text after the value, e.g. "19% behind". */
  note?: string;
}

export interface BarWidgetProps {
  /** Optional when `bare`. */
  title?: string;
  bars: BarWidgetBar[];
  /** Bar scale ceiling. Default 100 (percent). */
  max?: number;
  loading?: boolean;
  loadingLabel?: string;
  /** "Not enough data yet" — shown when `bars` is empty. */
  emptyLabel: string;
  error?: string;
  /** One vertical line through every bar at value/max, plus a legend line. */
  target?: { value: number; label: string };
  /** 'highlighted': highlighted bars primary, others muted. Default 'all'. */
  emphasis?: 'all' | 'highlighted';
  /** Render without the outer Card and heading (inside a WidgetCard). */
  bare?: boolean;
}

const pctOf = (v: number, max: number) =>
  max > 0 ? Math.min(100, Math.max(0, (v / max) * 100)) : 0;

export function BarWidget({
  title,
  bars,
  max = 100,
  loading = false,
  loadingLabel,
  emptyLabel,
  error,
  target,
  emphasis = 'all',
  bare = false,
}: BarWidgetProps) {
  if (loading) {
    return (
      <div aria-busy="true" aria-live="polite">
        {loadingLabel ? <span className="sr-only">{loadingLabel}</span> : null}
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  const body = (
    <>
      {title && !bare ? <h3 className="text-sm font-semibold">{title}</h3> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : bars.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {bars.map((b) => {
              const fill =
                emphasis === 'highlighted' && !b.highlight ? 'bg-muted-foreground' : 'bg-primary';
              return (
                <li key={b.label} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span
                      className={cn(
                        'min-w-0 truncate text-muted-foreground',
                        b.highlight && 'font-semibold',
                      )}
                    >
                      {b.label}
                    </span>
                    <span className="tabular-nums">
                      <span className="font-semibold">{b.valueLabel}</span>
                      {b.note ? <span className="ms-1 text-muted-foreground">{b.note}</span> : null}
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={b.value}
                    aria-valuemin={0}
                    aria-valuemax={max}
                    aria-valuetext={target ? `${b.valueLabel}, ${target.label}` : b.valueLabel}
                    aria-label={b.label}
                    className="relative h-2 w-full rounded-full bg-muted"
                  >
                    <div className="h-full overflow-hidden rounded-full">
                      <div
                        data-testid="bar-fill"
                        className={cn('h-full rounded-full', fill)}
                        style={{ width: `${pctOf(b.value, max)}%` }}
                      />
                    </div>
                    {target ? (
                      <span
                        data-testid="bar-target"
                        aria-hidden="true"
                        className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-text-primary"
                        style={{ left: `${pctOf(target.value, max)}%` }}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {target ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span aria-hidden="true" className="h-3 w-0.5 bg-text-primary" />
              {target.label}
            </p>
          ) : null}
        </>
      )}
    </>
  );

  if (bare) return <div className="flex flex-col gap-3">{body}</div>;
  return <Card className="flex h-full flex-col gap-3 p-4 text-card-foreground">{body}</Card>;
}
