/**
 * [52.5.1] Applications list: a tab row (inbox / mine / all) over one filter bar + table.
 * Hand-composed like `staff/evaluations.tsx` because `ListShell` has no tab slot.
 */
import { ApplicationStatus, ApplicationType, Permission } from '@biddaloy/shared';
import {
  RoutePending,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@biddaloy/ui/components';
import { useApplicationPendingCount, useHasPermission } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader, type PageAction } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { ChartColumnIcon, PlusIcon } from 'lucide-react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { ApplicationsTable, type ApplicationsView } from './-list/applications-table';

const applicationsSearchSchema = z.object({
  view: z.enum(['inbox', 'mine', 'all']).optional().catch(undefined),
  type: z.nativeEnum(ApplicationType).optional().catch(undefined),
  status: z.nativeEnum(ApplicationStatus).optional().catch(undefined),
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  class_id: z.string().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  // Row the reviewer just decided, so the list can focus its successor (D25).
  decided: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/applications/')({
  validateSearch: applicationsSearchSchema,
  loader: () =>
    loadRouteNamespaces('applications', 'applicationsList', 'feeStructures', 'nav', 'common'),
  pendingComponent: ApplicationsPending,
  component: ApplicationsPage,
});

const DAY_MS = 86_400_000;

function ApplicationsPage() {
  const { t } = useTranslation('applicationsList');
  const { t: tNav } = useTranslation('nav');
  const config = useTenantRegionConfig();
  const { view: urlView } = Route.useSearch();
  const navigate = Route.useNavigate();
  const canManage = useHasPermission(Permission.APPLICATION_MANAGE);
  const pending = useApplicationPendingCount();

  // `all` is for APPLICATION_MANAGE holders only; the default waits for the pending count.
  const requested = urlView === 'all' && !canManage ? undefined : urlView;
  const view: ApplicationsView | undefined =
    requested ??
    (pending.isLoading ? undefined : (pending.data?.total ?? 0) > 0 ? 'inbox' : 'mine');
  const total = pending.data?.total ?? 0;
  const oldest = pending.data?.oldest_pending_at;
  const ageDays = oldest ? Math.max(0, Math.floor((Date.now() - Date.parse(oldest)) / DAY_MS)) : 0;

  const goNew = () => void navigate({ to: '/applications/new' });
  const actions: PageAction[] = [
    { id: 'new', priority: 'primary', icon: <PlusIcon />, label: t('actions.new'), onClick: goNew },
    {
      id: 'reports',
      label: t('actions.reports'),
      icon: <ChartColumnIcon />,
      allowed: canManage,
      onClick: () => void navigate({ to: '/applications/reports' }),
    },
  ];

  const tabs: ApplicationsView[] = canManage ? ['inbox', 'mine', 'all'] : ['inbox', 'mine'];

  return (
    <PageContainer size="wide">
      <PageHeader
        title={tNav('items.applications')}
        subtitle={
          total > 0
            ? t('subtitle', {
                count: total,
                n: formatNumber(total, config),
                age: t('days', { n: formatNumber(ageDays, config) }),
              })
            : t('subtitleNone')
        }
        actions={actions}
      />
      {view === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Tabs
          value={view}
          // Filters and selection belong to a tab: switching drops them.
          onValueChange={(next) => void navigate({ search: { view: next as ApplicationsView } })}
        >
          <TabsList variant="line" aria-label={tNav('items.applications')}>
            {tabs.map((key) => (
              <TabsTrigger key={key} value={key}>
                {t(`tabs.${key}`)}
                {key === 'inbox' && total > 0 && (
                  <span className="ms-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1 text-caption text-secondary-foreground">
                    {formatNumber(total, config)}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={view} className="space-y-4 pt-4 md:pt-6">
            <ApplicationsTable key={view} view={view} onNew={goNew} />
          </TabsContent>
        </Tabs>
      )}
    </PageContainer>
  );
}

function ApplicationsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
