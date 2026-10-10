import { Card, ErrorState, Skeleton, StatusBadge } from '@biddaloy/ui/components';
import type { PlatformAttentionHealth } from '@biddaloy/ui/hooks';
import { useLocale, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, formatRelativeAge, formatTime } from '@biddaloy/ui/utils';

/** The quick sweep runs every 5 minutes; no run for this long means the engine is behind (D12). */
const STALE_MS = 15 * 60_000;

export interface EngineHealthCardProps {
  health: PlatformAttentionHealth | undefined;
  loading: boolean;
  /** Shows `ErrorState` with Retry. */
  error?: boolean;
  onRetry: () => void;
  now?: Date;
}

/**
 * [67.2.12] Presentational "Alert engine" card for the platform Schools page:
 * is the engine running, when each sweep last ran, and which rules are failing.
 * No fetching, same split as `-backup-health.tsx`.
 */
export function EngineHealthCard({
  health,
  loading,
  error,
  onRetry,
  now = new Date(),
}: EngineHealthCardProps) {
  const { t, i18n } = useTranslation('attention');
  const { locale } = useLocale();
  const config = useRegionConfig();

  if (loading) {
    return (
      <Card className="space-y-3 p-4 md:p-5" aria-busy="true">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-16 w-full" />
      </Card>
    );
  }
  if (error || !health) {
    return (
      <Card className="p-4 md:p-5">
        <ErrorState
          message={t('health.loadError')}
          retryLabel={t('modal.retry')}
          onRetry={onRetry}
        />
      </Card>
    );
  }

  const fast = health.lastSweep.FAST;
  const late = fast === null || now.getTime() - Date.parse(fast) > STALE_MS;
  const failing = health.failingRules.length;
  const badge =
    failing > 0 ? (
      <StatusBadge
        tone="danger"
        label={t('health.failing', { count: failing, n: formatNumber(failing, config) })}
      />
    ) : late ? (
      <StatusBadge tone="warning" label={t('health.late')} />
    ) : (
      <StatusBadge tone="success" label={t('health.ok')} />
    );

  const when = (iso: string | null) =>
    iso === null
      ? t('health.never')
      : `${formatRelativeAge(Date.parse(iso), locale, now.getTime())} · ${formatTime(iso, config)}`;
  const seconds = health.durationsMs.FAST;
  const facts: [string, string][] = [
    [t('health.lastFast'), when(fast)],
    [
      t('health.duration'),
      seconds === null
        ? t('health.never')
        : t('health.seconds', { n: formatNumber(seconds / 1000, config, { decimals: 1 }) }),
    ],
    [t('health.lastHourly'), when(health.lastSweep.HOURLY)],
    [t('health.lastDaily'), when(health.lastSweep.DAILY)],
  ];

  return (
    <Card className="space-y-4 p-4 md:p-5">
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-h2">{t('health.title')}</h2>
          {badge}
        </div>
        <p className="mt-0.5 text-text-secondary">{t('health.caption')}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:flex md:flex-wrap md:gap-x-8">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-caption text-text-secondary">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className="text-h3">{t('health.failingTitle')}</h3>
        {failing === 0 ? (
          <p className="text-text-secondary">{t('health.none')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border-subtle">
            {health.failingRules.map((rule) => (
              <li key={rule.key} className="flex flex-col gap-1 py-2">
                <p className="break-words">
                  <span className="font-medium">
                    {i18n.exists(`rules.${rule.key}.name`, { ns: 'attention' })
                      ? t(`rules.${rule.key}.name`)
                      : rule.key}
                  </span>
                  {' · '}
                  {t('health.failedTimes', {
                    count: rule.count,
                    n: formatNumber(rule.count, config),
                  })}
                </p>
                <p className="text-caption text-text-secondary">{t('health.lastError')}</p>
                <p className="font-mono text-caption break-words">{rule.lastError}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
