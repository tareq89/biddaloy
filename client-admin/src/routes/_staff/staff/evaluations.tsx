/**
 * [28.4.1] Staff › Evaluations — one place for every ACR, survey result and
 * incident (D1, D20). The route is gated on `ACR_READ`
 * (`route-permissions.ts`), so nothing here re-checks it. Each tab renders
 * one `FilterBar` + `DataTable`; the page's single `<h1>` is the `PageHeader`.
 * Tab + filters live in the URL, same as every list in this app.
 */
import { Permission } from '@biddaloy/shared';
import { RoutePending, Tabs, TabsContent, TabsList, TabsTrigger } from '@biddaloy/ui/components';
import { useHasPermission } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader, useCloseFullPage, type PageAction } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { ReportIncidentDialog } from './-detail/report-incident-dialog';
import { StartAcrDialog } from './-detail/start-acr-dialog';
import { AcrRegister } from './-evaluations/acr-register';
import { IncidentsList } from './-evaluations/incidents-list';
import { SurveyFormPage } from './-evaluations/survey-form-dialog';
import { SurveysList } from './-evaluations/surveys-list';

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
  publishSurvey: z.union([z.string(), z.number()]).optional().catch(undefined),
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
  // `publishSurvey` is not consumed: it stays in the URL while the full-page
  // survey form is open (Back and refresh then work); a viewer without
  // ACR_WRITE just has it stripped.
  React.useEffect(() => {
    const strayPublish = search.publishSurvey !== undefined && !canWrite;
    if (!search.reportIncident && !search.startAcr && !strayPublish) return;
    if (canWrite) {
      if (search.reportIncident) setReportOpen(true);
      if (search.startAcr) setStartOpen(true);
    }
    void navigate({
      search: (prev) => ({
        ...prev,
        reportIncident: undefined,
        startAcr: undefined,
        ...(strayPublish ? { publishSurvey: undefined } : {}),
      }),
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consume once per flag
  }, [search.reportIncident, search.startAcr, search.publishSurvey]);

  const closeSurvey = useCloseFullPage(
    () =>
      void navigate({ search: (prev) => ({ ...prev, publishSurvey: undefined }), replace: true }),
  );

  // One filled primary that follows the tab.
  const primaryFor: Record<(typeof TABS)[number], PageAction> = {
    acr: {
      id: 'startAcr',
      label: t('acr.start'),
      icon: <PlusIcon />,
      priority: 'primary',
      onClick: () => setStartOpen(true),
    },
    surveys: {
      id: 'newSurvey',
      label: t('surveys.new'),
      icon: <PlusIcon />,
      priority: 'primary',
      onClick: () =>
        void navigate({ search: (prev) => ({ ...prev, tab: 'surveys', publishSurvey: 1 }) }),
    },
    incidents: {
      id: 'reportIncident',
      label: t('incident.report'),
      icon: <PlusIcon />,
      priority: 'primary',
      onClick: () => setReportOpen(true),
    },
  };

  return (
    <PageContainer size="wide">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={canWrite ? [primaryFor[tab]] : []}
      />
      <Tabs
        value={tab}
        onValueChange={(next) =>
          // Filters belong to a tab — drop them when switching.
          void navigate({ search: { tab: next as (typeof TABS)[number] } })
        }
      >
        <TabsList variant="line" aria-label={t('title')}>
          {TABS.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`tabs.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="acr" className="space-y-4 pt-4 md:pt-6">
          <AcrRegister />
        </TabsContent>
        <TabsContent value="surveys" className="space-y-4 pt-4 md:pt-6">
          <SurveysList />
        </TabsContent>
        <TabsContent value="incidents" className="space-y-4 pt-4 md:pt-6">
          <IncidentsList />
        </TabsContent>
        {canWrite && (
          <>
            <ReportIncidentDialog open={reportOpen} onOpenChange={setReportOpen} />
            <StartAcrDialog open={startOpen} onOpenChange={setStartOpen} />
          </>
        )}
      </Tabs>
      {canWrite && search.publishSurvey !== undefined && <SurveyFormPage onDone={closeSurvey} />}
    </PageContainer>
  );
}

function EvaluationsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
