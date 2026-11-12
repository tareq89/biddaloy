import { Button, Card, ConfirmDialog, StatusBadge } from '@biddaloy/ui/components';
import type { OpsSystem } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

type Restoring = OpsSystem['restoring'][number];

export interface RestoreLockCardProps {
  restoring: Restoring[];
  busy?: boolean;
  /** Called after the owner confirms; the page asks for the code. */
  onRelease: (schoolId: string) => void;
}

/** Schools that are restoring, each with a Release button behind a confirm. */
export function RestoreLockCard({ restoring, busy, onRelease }: RestoreLockCardProps) {
  const { t } = useTranslation('platformOperations');
  const [target, setTarget] = React.useState<Restoring | null>(null);

  return (
    <Card padded role="region" aria-labelledby="ops-restore-title" className="space-y-3">
      <h2 id="ops-restore-title" className="text-h2">
        {t('restore.title')}
      </h2>
      {restoring.length === 0 ? (
        <p className="text-muted-foreground">{t('restore.none')}</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {restoring.map((row) => (
            <li
              key={row.schoolId}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{row.schoolName}</span>
                <StatusBadge
                  tone={row.jobStatus === 'RUNNING' ? 'info' : 'neutral'}
                  label={t(`restore.status.${row.jobStatus}`)}
                />
                {row.locked && <StatusBadge tone="warning" label={t('restore.locked')} />}
              </div>
              <Button
                variant="outline"
                aria-label={t('restore.releaseFor', { name: row.schoolName })}
                disabled={!row.locked || busy}
                onClick={() => setTarget(row)}
              >
                {t('restore.release')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={t('restore.confirmTitle', { name: target?.schoolName ?? '' })}
        description={t('restore.confirmBody')}
        confirmLabel={t('restore.release')}
        tone="default"
        onConfirm={() => {
          if (target) onRelease(target.schoolId);
          setTarget(null);
        }}
      />
    </Card>
  );
}
