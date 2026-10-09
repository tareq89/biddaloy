/**
 * [67.2.08] A strip on a student's page: what is open about this student and
 * who has seen it. Read-only (staff are not the recipients, so no close or
 * snooze). Tinted by the highest severity; the badge icon keeps it readable
 * without colour. Presentational.
 */
import type { AlertSeverity } from '@biddaloy/shared';
import { EyeIcon } from 'lucide-react';

import type { StudentAlert } from '../../api/attention';
import { useLocale, useTranslation } from '../../i18n';
import { cn } from '../../primitives/lib/utils';
import { formatRelativeAge } from '../../utils';
import { Button } from '../button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../dialog';
import { ALERT_SEVERITY_ICON } from '../status-badge';

import { AlertSeverityBadge } from './alert-severity-badge';

const ORDER = ['CRITICAL', 'WARNING', 'REMINDER'] as const;
const TINT = {
  CRITICAL: 'bg-status-overdue-bg text-status-overdue-fg',
  WARNING: 'bg-status-due-bg text-status-due-fg',
  REMINDER: 'bg-status-partial-bg text-status-partial-fg',
} as const;

export interface StudentAlertStripProps {
  studentName: string;
  alerts: readonly StudentAlert[];
  className?: string;
}

export function StudentAlertStrip({ studentName, alerts, className }: StudentAlertStripProps) {
  const { t } = useTranslation('attention');
  const { locale } = useLocale();
  if (alerts.length === 0) return null;

  const numbers = new Intl.NumberFormat(locale, { useGrouping: false });
  const seenLine = (a: StudentAlert) =>
    a.recipientCount > 1
      ? t('strip.seen', {
          seen: numbers.format(a.seenCount),
          total: numbers.format(a.recipientCount),
        })
      : null;
  const top = ORDER.find((s) => alerts.some((a) => a.severity === s)) ?? 'REMINDER';
  const first = alerts.find((a) => a.severity === top) ?? alerts[0]!;
  const Icon = ALERT_SEVERITY_ICON[top as AlertSeverity];
  const firstSeen = seenLine(first);

  return (
    <section
      aria-label={t('strip.label')}
      data-tone={top}
      className={cn(
        'flex flex-col gap-3 rounded-lg px-4 py-3 sm:flex-row sm:items-center',
        TINT[top],
        className,
      )}
    >
      <Icon aria-hidden className="size-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium">
          {t(`severity.${top}`)}: {first.title}
          {alerts.length > 1 &&
            ` · ${t('strip.more', { count: alerts.length - 1, n: numbers.format(alerts.length - 1) })}`}
        </p>
        {firstSeen && (
          <p className="inline-flex items-center gap-1 text-caption">
            <EyeIcon className="size-3.5" aria-hidden />
            {firstSeen}
          </p>
        )}
      </div>
      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            className="min-h-11 w-full bg-surface text-text-primary sm:min-h-0 sm:w-auto"
          >
            {t('strip.details')}
          </Button>
        </DialogTrigger>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t('strip.dialogTitle', { name: studentName })}</DialogTitle>
            <DialogDescription className="sr-only">{t('strip.label')}</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-3">
            {alerts.map((a) => (
              <li
                key={a.alertId}
                className="flex flex-col gap-1 rounded-lg border border-border-subtle p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-caption text-text-secondary">
                  <AlertSeverityBadge severity={a.severity as AlertSeverity} />
                  <span>{formatRelativeAge(Date.parse(a.raisedAt), locale)}</span>
                  {seenLine(a) && <span>{seenLine(a)}</span>}
                </div>
                <p className="font-medium">{a.title}</p>
                <p className="text-text-secondary">{a.why}</p>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </section>
  );
}
