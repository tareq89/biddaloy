/**
 * [28.4.2] Staff detail › Incidents tab: this person's incidents plus a
 * Report button (ACR_WRITE) that opens the shared `ReportIncidentDialog`.
 */
import { Permission } from '@biddaloy/shared';
import { Button, EmptyState } from '@biddaloy/ui/components';
import { useHasPermission, useIncidents } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseDate } from '@biddaloy/ui/utils';
import * as React from 'react';

import { ReportIncidentDialog } from './report-incident-dialog';
import { TabQueryState } from './tab-query-state';

export interface IncidentsTabProps {
  userId: string;
}

export function IncidentsTab({ userId }: IncidentsTabProps) {
  const { t } = useTranslation('evaluations');
  const regionConfig = useTenantRegionConfig();
  const query = useIncidents({ staffUserId: userId });
  const canWrite = useHasPermission(Permission.ACR_WRITE);
  const [reportOpen, setReportOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('incident.title')}</h2>
        {canWrite && (
          <Button type="button" onClick={() => setReportOpen(true)}>
            {t('incident.report')}
          </Button>
        )}
      </div>
      <TabQueryState
        query={query}
        forbiddenMessage={t('forbidden')}
        errorMessage={t('incident.loadError')}
      >
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title={t('incident.title')} explanation={t('incident.empty')} />
          ) : (
            <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 p-3 text-sm">
                  <span className="font-medium">
                    {t(`incident.types.${r.type}`)} · {t(`incident.severities.${r.severity}`)} ·{' '}
                    {formatDate(parseDate(r.occurredOn), regionConfig)}
                  </span>
                  <span>{r.description}</span>
                </li>
              ))}
            </ul>
          )
        }
      </TabQueryState>
      {canWrite && (
        <ReportIncidentDialog open={reportOpen} onOpenChange={setReportOpen} staffUserId={userId} />
      )}
    </div>
  );
}
