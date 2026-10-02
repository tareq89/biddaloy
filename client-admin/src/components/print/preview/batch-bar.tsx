/**
 * [32.3.4] Where you are in a multi-batch run (D10). Batches are sequential:
 * batch N+1 is locked until batch N has been confirmed, so this only ever offers
 * the current one — the rest are shown as locked, not clickable.
 */
import { useTranslation } from '@biddaloy/ui/i18n';

export interface BatchBarProps {
  /** Number of subjects in each batch, in order. */
  batchSizes: number[];
  /** Index of the batch being worked on (all before it are confirmed). */
  current: number;
}

export function BatchBar({ batchSizes, current }: BatchBarProps) {
  const { t } = useTranslation('printPreview');
  if (batchSizes.length <= 1) return null;

  return (
    <ol
      aria-label={t('header.batch', {
        current: current + 1,
        total: batchSizes.length,
        count: batchSizes[current] ?? 0,
      })}
      className="flex flex-wrap gap-2"
    >
      {batchSizes.map((size, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'locked';
        return (
          <li
            key={index}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
            className={
              state === 'current'
                ? 'rounded-md border border-primary bg-primary/10 px-2 py-1 text-xs font-medium'
                : 'rounded-md border border-border-subtle px-2 py-1 text-xs text-muted-foreground'
            }
          >
            {index + 1} · {size}
            {state === 'done' ? ' ✓' : ''}
            {state === 'locked' ? <span className="sr-only"> ({t('locked')})</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
