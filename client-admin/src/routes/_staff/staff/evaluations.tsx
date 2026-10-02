/**
 * [28.4.1] Staff › Evaluations — one place for every ACR, survey result and
 * incident (D1, D20). The route is gated on `ACR_READ`
 * (`route-permissions.ts`), so nothing here re-checks it. Each tab renders
 * one `ListShell`/`EmptyState`, whose `<h1>` is the page's single heading.
 * Tab + filters live in the URL, same as every list in this app.
 */
import { Permission } from '@biddaloy/shared';
import {
  EmptyState,
  RoutePending,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@biddaloy/ui/components';
import { useHasPermission } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { ReportIncidentDialog } from './-detail/report-incident-dialog';
import { StartAcrDialog } from './-detail/start-acr-dialog';
import { AcrRegister } from './-evaluations/acr-register';
import { IncidentsList } from './-evaluations/incidents-list';

const TABS = ['acr', 'surveys', 'incidents'] as const;

const evaluationsSearchSchema = z.object({
  tab: z.enum(TABS).optional().catch(undefined),
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  sort: z.string().optional().catch(undefined),
  order: z.enum(['asc', 'desc']).optional().catch(undefined),
  year: z.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
  type: z.string().optional().catch(undefined),
  severity: z.string().optional().catch(undefined),
  selected: z.string().optional().catch(undefined),
  // One-shot palette flags (`action-registry.ts`): open the shared dialogs.
  // TanStack parses `?x=1` into the number 1, so a bare z.string() would drop it.
  reportIncident: z.union([z.string(), z.number()]).optional().catch(undefined),
  startAcr: z.union([z.string(), z.number()]).optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/staff/evaluations')({
  validateSearch: evaluationsSearchSchema,
  loader: () => loadRouteNamespaces('evaluations', 'staff', 'common'),
  pendingComponent: EvaluationsPending,
  component: EvaluationsPage,
});

function EvaluationsPage() {
  const { t } = useTranslation('evaluations');
  const { tab = 'acr' } = Route.useSearch();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const canWrite = useHasPermission(Permission.ACR_WRITE);
  const [reportOpen, setReportOpen] = React.useState(false);
  const [startOpen, setStartOpen] = React.useState(false);

  // Consume the palette's one-shot flags, same pattern as fees/fines.
  React.useEffect(() => {
    if (!search.reportIncident && !search.startAcr) return;
    if (canWrite) {
      if (search.reportIncident) setReportOpen(true);
      if (search.startAcr) setStartOpen(true);
    }
    void navigate({
      search: (prev) => ({ ...prev, reportIncident: undefined, startAcr: undefined }),
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consume once per flag
  }, [search.reportIncident, search.startAcr]);

  return (
    <Tabs
      value={tab}
      onValueChange={(next) =>
        // Filters belong to a tab — drop them when switching.
        void navigate({ search: { tab: next as (typeof TABS)[number] } })
      }
      className="flex flex-col gap-4"
    >
      <TabsList aria-label={t('title')}>
        {TABS.map((key) => (
          <TabsTrigger key={key} value={key}>
            {t(`tabs.${key}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="acr">
        <AcrRegister />
      </TabsContent>
      <TabsContent value="surveys">
        {/* Placeholder slot — filled by 28.4.2. */}
        <EmptyState
          title={t('surveys.placeholderTitle')}
          explanation={t('surveys.placeholderBody')}
        />
      </TabsContent>
      <TabsContent value="incidents">
        <IncidentsList />
      </TabsContent>
      {canWrite && (
        <>
          <ReportIncidentDialog open={reportOpen} onOpenChange={setReportOpen} />
          <StartAcrDialog open={startOpen} onOpenChange={setStartOpen} />
        </>
      )}
    </Tabs>
  );
}

function EvaluationsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
