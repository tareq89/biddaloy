/**
 * [67.2.04] The one-line "needs your attention" bar for the top of a shell.
 * Presentational: the shell passes the summary and opens the modal. Renders
 * nothing while loading (no layout jump, D18) and when there is nothing to
 * do (D14).
 */
import { AlertSeverity } from '@biddaloy/shared';
import * as React from 'react';

import type { AttentionSummary } from '../../api/attention';
import { useLocale, useTranslation } from '../../i18n';
import { NoticeBar } from '../notice-bar';
import { ALERT_SEVERITY_ICON } from '../status-badge';

export interface AttentionBarProps {
  summary: AttentionSummary | undefined;
  onOpen: () => void;
  /** Receives the bar's button, so the modal can return focus to it. */
  buttonRef?: React.Ref<HTMLButtonElement>;
  className?: string;
}

export function AttentionBar({ summary, onOpen, buttonRef, className }: AttentionBarProps) {
  const { t } = useTranslation('attention');
  const { locale } = useLocale();
  if (!summary || summary.critical + summary.warning + summary.reminder === 0) return null;

  const { critical, warning, reminder, top } = summary;
  const numbers = new Intl.NumberFormat(locale, { useGrouping: false });
  const counts = (
    [
      ['critical', critical],
      ['warning', warning],
      ['reminder', reminder],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(([key, count]) => t(`bar.${key}`, { count, n: numbers.format(count) }));
  const mostUrgent = top ? t('bar.mostUrgent', { title: top.title }) : null;
  const severity =
    critical > 0
      ? AlertSeverity.CRITICAL
      : warning > 0
        ? AlertSeverity.WARNING
        : AlertSeverity.REMINDER;
  const tone = critical > 0 ? 'danger' : warning > 0 ? 'warning' : 'info';

  return (
    <NoticeBar
      tone={tone}
      icon={ALERT_SEVERITY_ICON[severity]}
      onOpenDetails={onOpen}
      {...(buttonRef ? { detailsButtonRef: buttonRef } : {})}
      detailsHasPopup="dialog"
      className={`motion-safe:animate-in motion-safe:slide-in-from-top-2${className ? ` ${className}` : ''}`}
    >
      {/* Phone: one count and the top title. From `sm` up: every count. */}
      <span className="sm:hidden">{[counts[0], mostUrgent].filter(Boolean).join(' · ')}</span>
      <span className="hidden sm:inline">
        {[...counts, mostUrgent].filter(Boolean).join(' · ')}
      </span>
    </NoticeBar>
  );
}
