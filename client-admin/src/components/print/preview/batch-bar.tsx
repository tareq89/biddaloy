/**
 * [32.3.4] Where you are in a multi-batch run (D10). Batches are sequential:
 * batch N+1 is locked until batch N has been confirmed, so this only ever offers
 * the current one — the rest are shown as locked, not clickable.
 */
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CircleCheckIcon, LockIcon, PrinterIcon } from 'lucide-react';

export interface BatchBarProps {
  /** Number of subjects in each batch, in order. */
  batchSizes: number[];
  /** Index of the batch being worked on (all before it are confirmed). */
  current: number;
}

const CHIP = 'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-label';
const STATE_CLASS = {
  done: 'bg-status-paid-bg text-status-paid-fg',
  current: 'bg-secondary font-semibold text-secondary-foreground ring-2 ring-primary ring-inset',
  locked: 'bg-muted text-text-secondary',
} as const;

export function BatchBar({ batchSizes, current }: BatchBarProps) {
  const { t } = useTranslation('printPreview');
  const region = useRegionConfig();
  if (batchSizes.length <= 1) return null;

  return (
    <ol aria-label={t('round.listLabel')} className="flex flex-wrap gap-2">
      {batchSizes.map((size, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'locked';
        const Icon =
          state === 'done' ? CircleCheckIcon : state === 'current' ? PrinterIcon : LockIcon;
        return (
          <li
            key={index}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
            className={`${CHIP} ${STATE_CLASS[state]}`}
          >
            <Icon className="size-3.5" aria-hidden />
            {t('round.step', {
              n: formatNumber(index + 1, region),
              count: formatNumber(size, region),
            })}
            {state === 'locked' ? <span className="sr-only"> ({t('locked')})</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
