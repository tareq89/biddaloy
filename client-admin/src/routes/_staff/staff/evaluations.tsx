/**
 * [28.4.1] Staff › Evaluations — one place for every ACR, survey result and
 * incident (D1, D20). The route is gated on `ACR_READ`
 * (`route-permissions.ts`), so nothing here re-checks it. Each tab renders
 * one `ListShell`/`EmptyState`, whose `<h1>` is the page's single heading.
 * Tab + filters live in the URL, same as every list in this app.
 */
import {
  EmptyState,
  RoutePending,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

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
  const navigate = Route.useNavigate();

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
    </Tabs>
  );
}

function EvaluationsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
