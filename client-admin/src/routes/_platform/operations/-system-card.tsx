import { Card, StatusBadge } from '@biddaloy/ui/components';
import type { OpsSystem } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

/** App version, last migration, database and Redis. A red state names what is down. */
export function SystemCard({ system }: { system: OpsSystem }) {
  const { t } = useTranslation('platformOperations');
  const down = [
    ...(system.database === 'fail' ? [t('system.database')] : []),
    ...(system.redis === 'fail' ? [t('system.redis')] : []),
  ];
  const badge = (ok: 'ok' | 'fail') => (
    <StatusBadge tone={ok === 'ok' ? 'success' : 'danger'} label={t(`system.${ok}`)} />
  );

  return (
    <Card padded aria-labelledby="ops-system-title" role="region" className="space-y-3">
      <h2 id="ops-system-title" className="text-h2">
        {t('system.title')}
      </h2>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-caption text-muted-foreground">{t('system.appVersion')}</dt>
          <dd className="font-medium">{system.appVersion}</dd>
        </div>
        <div>
          <dt className="text-caption text-muted-foreground">{t('system.lastMigration')}</dt>
          <dd className="font-medium break-all">
            {system.lastMigration ?? t('system.noMigration')}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-muted-foreground">{t('system.database')}</dt>
          <dd>{badge(system.database)}</dd>
        </div>
        <div>
          <dt className="text-caption text-muted-foreground">{t('system.redis')}</dt>
          <dd>{badge(system.redis)}</dd>
        </div>
      </dl>
      <p
        role="status"
        className={down.length ? 'text-danger font-medium' : 'text-muted-foreground'}
      >
        {down.length
          ? t('system.down', { names: down.join(t('system.downJoin')) })
          : t('system.allGood')}
      </p>
    </Card>
  );
}
