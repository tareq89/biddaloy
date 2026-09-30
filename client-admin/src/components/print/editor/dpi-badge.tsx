/**
 * [32.3.2] "Will this image print sharp?" as a coloured pill with words (colour is
 * never the only signal). Sized against the millimetres the image actually covers.
 */
import { useTranslation } from '@biddaloy/ui/i18n';

import { dpiLevel, effectiveDpi, type DpiLevel } from './dpi';

const TONE: Record<DpiLevel, string> = {
  good: 'bg-status-paid-bg text-status-paid-fg',
  ok: 'bg-status-due-bg text-status-due-fg',
  low: 'bg-status-overdue-bg text-status-overdue-fg',
};

export interface DpiBadgeProps {
  widthPx: number | null;
  elementWidthMm: number;
}

export function DpiBadge({ widthPx, elementWidthMm }: DpiBadgeProps) {
  const { t } = useTranslation('printEditor');
  // An asset with no pixel size (an SVG) is resolution-independent: nothing to warn about.
  if (widthPx === null || widthPx <= 0) return null;
  const dpi = effectiveDpi(widthPx, elementWidthMm);
  const level = dpiLevel(dpi);
  return (
    <span
      data-dpi-level={level}
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${TONE[level]}`}
    >
      {t(`dpi.${level}`)} · {t('dpi.value', { dpi: Math.round(dpi) })}
    </span>
  );
}
