/** [67.5.06] The four headline numbers of the alerts report (plain Cards, not StatTile: D41). */
import { AlertSeverity } from '@biddaloy/shared';
import { AlertSeverityBadge, Card } from '@biddaloy/ui/components';
import type { AlertsReport } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatMonth, formatNumber } from '@biddaloy/ui/utils';

/** `"2026-10"` -> `"2026-09"`. */
function previousMonth(month: string): string {
  const [y = 0, m = 1] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function Fact({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <Card padded className="flex flex-col gap-1">
      <p className="text-label text-text-secondary">{label}</p>
      <p className="text-h1 tabular-nums">{value}</p>
      {children}
    </Card>
  );
}

export function AlertsReportFacts({ report }: { report: AlertsReport }) {
  const { t } = useTranslation('attention');
  const config = useTenantRegionConfig();
  const n = (value: number) => formatNumber(value, config);
  const { facts } = report;

  const prev = formatMonth(previousMonth(report.month), config);
  const delta = facts.total - facts.previousMonthTotal;
  const compare =
    delta === 0
      ? t('report.sameAs', { month: prev })
      : t(delta < 0 ? 'report.fewerThan' : 'report.moreThan', {
          n: n(Math.abs(delta)),
          month: prev,
        });
  const pct = facts.total === 0 ? 0 : Math.round((facts.resolved / facts.total) * 100);
  const avg = facts.avgResolveMinutes;
  const avgText =
    avg === null
      ? '—'
      : avg < 60
        ? t('report.minutes', { n: n(Math.round(avg)) })
        : t('report.hours', { n: n(Math.round((avg / 60) * 10) / 10) });

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
      <Fact label={t('report.factTotal')} value={n(facts.total)}>
        <p className="text-caption text-text-secondary">{compare}</p>
      </Fact>
      <Fact label={t('report.factFixed')} value={n(facts.resolved)}>
        <p className="text-caption text-text-secondary">
          {t('report.fixedShare', { pct: n(pct) })}
        </p>
      </Fact>
      <Fact label={t('report.factAvgFix')} value={avgText} />
      <Fact label={t('report.factOpen')} value={n(facts.open)}>
        {facts.openCritical > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <AlertSeverityBadge severity={AlertSeverity.CRITICAL} />
            <span className="text-caption text-text-secondary">
              {t('report.openUrgent', { n: n(facts.openCritical) })}
            </span>
          </div>
        )}
      </Fact>
    </div>
  );
}
