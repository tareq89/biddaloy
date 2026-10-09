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
}

export interface BarWidgetProps {
  title: string;
  bars: BarWidgetBar[];
  /** Bar scale ceiling. Default 100 (percent). */
  max?: number;
  loading?: boolean;
  loadingLabel?: string;
  /** "Not enough data yet" — shown when `bars` is empty. */
  emptyLabel: string;
  error?: string;
}

export function BarWidget({
  title,
  bars,
  max = 100,
  loading = false,
  loadingLabel,
  emptyLabel,
  error,
}: BarWidgetProps) {
  if (loading) {
    return (
      <div aria-busy="true" aria-live="polite">
        {loadingLabel ? <span className="sr-only">{loadingLabel}</span> : null}
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <Card className="flex h-full flex-col gap-3 p-4 text-card-foreground">
      <h3 className="text-sm font-semibold">{title}</h3>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : bars.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {bars.map((b) => {
            const pct = max > 0 ? Math.min(100, Math.max(0, (b.value / max) * 100)) : 0;
            return (
              <li key={b.label} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-muted-foreground">{b.label}</span>
                  <span className="font-semibold tabular-nums">{b.valueLabel}</span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={b.value}
                  aria-valuemin={0}
                  aria-valuemax={max}
                  aria-valuetext={b.valueLabel}
                  aria-label={b.label}
                  className="h-2 w-full overflow-hidden rounded-full bg-muted"
                >
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
