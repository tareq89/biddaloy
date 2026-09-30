import { Card } from '../card';
import { Skeleton } from '../skeleton';

/**
 * [28.x] Performance headline card — one big number plus up to 3 smaller
 * figures. Pure presentational: every string arrives already translated and
 * digit-localised (same prop-driven i18n convention as the rest of the lib).
 */
export interface SummaryCardFigure {
  label: string;
  /** Already formatted, e.g. "82%". */
  value: string;
}

export interface SummaryCardProps {
  title: string;
  headline: SummaryCardFigure | null;
  figures?: SummaryCardFigure[];
  loading?: boolean;
  loadingLabel?: string;
  /** Shown instead of the numbers when `headline` is null. */
  emptyLabel?: string;
  error?: string;
}

export function SummaryCard({
  title,
  headline,
  figures = [],
  loading = false,
  loadingLabel,
  emptyLabel,
  error,
}: SummaryCardProps) {
  if (loading) {
    return (
      <div aria-busy="true" aria-live="polite">
        {loadingLabel ? <span className="sr-only">{loadingLabel}</span> : null}
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-normal text-muted-foreground">{title}</h2>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : headline === null ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <>
          <dl className="flex flex-col gap-0.5">
            <dt className="text-sm font-normal text-muted-foreground">{headline.label}</dt>
            <dd className="text-3xl leading-tight font-bold tabular-nums">{headline.value}</dd>
          </dl>
          {figures.length > 0 ? (
            <dl className="grid grid-cols-3 gap-2 border-t border-border-subtle pt-3">
              {figures.slice(0, 3).map((f) => (
                <div key={f.label} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-[11px] text-muted-foreground">{f.label}</dt>
                  <dd className="text-sm font-semibold tabular-nums">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </>
      )}
    </Card>
  );
}
