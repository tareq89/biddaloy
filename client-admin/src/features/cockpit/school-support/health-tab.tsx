/**
 * #3822 School 360, "Health" tab: this school's backup row, the alert engine card and the school's
 * open alerts by severity (from the overview). The two cards are the existing platform ones,
 * imported unchanged. Backup health and engine health are platform lists, so this tab keeps this
 * school's backup row only.
 */
import { Card, ErrorState, Skeleton, StatusBadge } from '@biddaloy/ui/components';
import {
  usePlatformAttentionHealth,
  usePlatformBackupHealth,
  useSchoolOverview,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';

import { BackupHealthTable } from '../../../routes/_platform/schools/-backup-health';
import { EngineHealthCard } from '../../../routes/_platform/schools/-engine-health';

const SEVERITY_TONE: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  critical: 'danger',
  high: 'danger',
  warning: 'warning',
  medium: 'warning',
  info: 'info',
};

export function HealthTab({ schoolId }: { schoolId: string }) {
  const { t } = useTranslation('schoolSupport');
  const config = useRegionConfig();
  const backup = usePlatformBackupHealth();
  const engine = usePlatformAttentionHealth();
  const overview = useSchoolOverview(schoolId);
  const alerts = overview.data?.openAlerts ?? [];

  return (
    <div className="space-y-4">
      <BackupHealthTable
        rows={(backup.data ?? []).filter((r) => r.school_id === schoolId)}
        loading={backup.isLoading}
        isFetching={backup.isFetching}
        {...(backup.isError ? { error: t('health.loadError') } : {})}
      />
      <EngineHealthCard
        health={engine.data}
        loading={engine.isLoading}
        error={engine.isError}
        onRetry={() => void engine.refetch()}
      />
      <Card className="space-y-3 p-4 md:p-5">
        <h2 className="text-h3 font-semibold">{t('health.alertsTitle')}</h2>
        {overview.isLoading ? (
          <Skeleton className="h-6 w-40" />
        ) : overview.isError ? (
          <ErrorState
            message={t('health.loadError')}
            retryLabel={t('health.retry')}
            onRetry={() => void overview.refetch()}
          />
        ) : alerts.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">{t('health.alertsNone')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {alerts.map((a) => (
              <li key={a.severity}>
                <StatusBadge
                  tone={SEVERITY_TONE[a.severity] ?? 'neutral'}
                  label={`${t(`health.severity.${a.severity.toLowerCase()}`, { defaultValue: a.severity })}: ${formatNumber(a.count, config)}`}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
