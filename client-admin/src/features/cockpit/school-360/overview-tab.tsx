/**
 * #3820 School 360, "Overview" tab: one card from the overview hook (#3817), admins, people by
 * role, SMS balance, files size, open alerts, last activity and the latest changes. The route
 * adds the existing stats and seats cards below it.
 */
import { Card, ErrorState, Skeleton, StatusBadge } from '@biddaloy/ui/components';
import { useSchoolOverview } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatFileSize(bytes: number, format: (n: number) => string): string {
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${format(unit === 0 ? size : Math.round(size * 10) / 10)} ${UNITS[unit]}`;
}

const SEVERITY_TONE: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  critical: 'danger',
  high: 'danger',
  warning: 'warning',
  medium: 'warning',
  info: 'info',
};

export function OverviewTab({ schoolId }: { schoolId: string }) {
  const { t } = useTranslation('school360');
  const { t: tRole } = useTranslation('loginAs');
  const config = useRegionConfig();
  const overview = useSchoolOverview(schoolId);
  const num = (n: number) => formatNumber(n, config);

  if (overview.isLoading) return <Skeleton className="h-48 w-full" />;
  if (overview.isError || !overview.data) {
    return (
      <ErrorState
        message={t('overview.loadError')}
        retryLabel={t('overview.retry')}
        onRetry={() => void overview.refetch()}
      />
    );
  }
  const o = overview.data;
  const admins = o.admins ?? [];
  const people = o.peopleByRole ?? [];
  const alerts = o.openAlerts ?? [];
  const audit = o.recentAudit ?? [];

  return (
    <Card className="space-y-4 p-4 md:p-5">
      <h2 className="text-h3 font-semibold">{t('overview.title')}</h2>
      <dl className="grid gap-4 md:grid-cols-2">
        <div>
          <dt className="text-body-sm text-muted-foreground">{t('overview.admins')}</dt>
          <dd>
            {admins.length === 0 ? (
              t('overview.noAdmins')
            ) : (
              <ul>
                {admins.map((a) => (
                  <li key={a.userId}>{a.name}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-body-sm text-muted-foreground">{t('overview.activeByRole')}</dt>
          <dd>
            {people.length === 0 ? (
              t('overview.noPeople')
            ) : (
              <ul>
                {people.map((p) => (
                  <li key={p.role}>
                    {tRole(`roles.${p.role}`, { defaultValue: p.role })}: {num(p.count)}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-body-sm text-muted-foreground">{t('overview.sms')}</dt>
          <dd>
            {o.smsBalance
              ? t('overview.smsValue', {
                  available: num(o.smsBalance.available),
                  reserved: num(o.smsBalance.reserved),
                })
              : '-'}
          </dd>
        </div>
        <div>
          <dt className="text-body-sm text-muted-foreground">{t('overview.storage')}</dt>
          <dd>{o.filesBytes == null ? '-' : formatFileSize(o.filesBytes, num)}</dd>
        </div>
        <div>
          <dt className="text-body-sm text-muted-foreground">{t('overview.alerts')}</dt>
          <dd>
            {alerts.length === 0 ? (
              t('overview.noAlerts')
            ) : (
              <ul className="flex flex-wrap gap-2">
                {alerts.map((a) => (
                  <li key={a.severity}>
                    <StatusBadge
                      tone={SEVERITY_TONE[a.severity.toLowerCase()] ?? 'neutral'}
                      label={`${a.severity}: ${num(a.count)}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-body-sm text-muted-foreground">{t('overview.lastActivity')}</dt>
          <dd>{o.lastActivityAt ? formatDate(o.lastActivityAt, config) : t('overview.never')}</dd>
        </div>
      </dl>
      <div>
        <h3 className="text-body font-semibold">{t('overview.recentAudit')}</h3>
        {audit.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">{t('overview.noAudit')}</p>
        ) : (
          <ul className="text-body-sm space-y-1">
            {audit.map((r) => (
              <li key={r.id}>
                {formatDate(r.createdAt, config)} · {r.action} · {r.entityType}
                {r.actorName ? ` · ${t('overview.byActor', { name: r.actorName })}` : ''}
                {r.viaLoginAs ? ` · ${t('overview.viaLoginAs')}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
