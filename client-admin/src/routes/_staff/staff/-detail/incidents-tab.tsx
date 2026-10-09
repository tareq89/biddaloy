/**
 * [28.4.2] Staff detail › Incidents tab: this person's incidents plus a
 * Report button (ACR_WRITE) that opens the shared `ReportIncidentDialog`.
 */
import { Permission } from '@biddaloy/shared';
import { Button, EmptyState, StatusBadge, type StatusTone } from '@biddaloy/ui/components';
import { useHasPermission, useIncidents } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseDate } from '@biddaloy/ui/utils';
import { FlagIcon } from 'lucide-react';
import * as React from 'react';

import { ReportIncidentDialog } from './report-incident-dialog';
import { TabQueryState } from './tab-query-state';

const SEVERITY_TONE: Record<string, StatusTone> = {
  LOW: 'neutral',
  MEDIUM: 'warning',
  HIGH: 'danger',
};

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
    <section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h2">{t('incident.title')}</h2>
        {canWrite && (
          <Button type="button" variant="outline" onClick={() => setReportOpen(true)}>
            <FlagIcon aria-hidden="true" />
            {t('incident.report')}
          </Button>
        )}
      </div>
      <div className="mt-4">
        <TabQueryState
          query={query}
          forbiddenMessage={t('forbidden')}
          errorMessage={t('incident.loadError')}
        >
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState title={t('incident.title')} explanation={t('incident.empty')} />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 py-3 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{t(`incident.types.${r.type}`)}</span>
                      <StatusBadge
                        tone={SEVERITY_TONE[r.severity] ?? 'neutral'}
                        label={t(`incident.severities.${r.severity}`)}
                      />
                    </div>
                    <span className="text-text-secondary">
                      {formatDate(parseDate(r.occurredOn), regionConfig)}
                    </span>
                    <span>{r.description}</span>
                  </li>
                ))}
              </ul>
            )
          }
        </TabQueryState>
      </div>
      {canWrite && (
        <ReportIncidentDialog open={reportOpen} onOpenChange={setReportOpen} staffUserId={userId} />
      )}
    </section>
  );
}
