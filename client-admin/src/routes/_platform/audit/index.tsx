import { Button, Tabs, TabsList, TabsTrigger } from '@biddaloy/ui/components';
import { usePlatformAudit, usePlatformAuditSessions } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { AuditFilters, type AuditFilterValues } from './-audit-filters';
import { AuditTable } from './-audit-table';
import { LoginAsLog } from './-login-as-log';

/**
 * Epic 99 #3825: search audit rows across all schools, and every Login as visit. Every filter,
 * the tab and the cursor live in the URL. Paging is by cursor only (the server has no offset);
 * the cursor resets whenever a filter or the tab changes.
 */
const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const searchSchema = z.object({
  tab: optional(z.enum(['all', 'visits'])),
  tenantId: optional(z.string()),
  action: optional(z.string()),
  actorId: optional(z.string()),
  sessionId: optional(z.string()),
  from: optional(z.string()),
  to: optional(z.string()),
  cursor: optional(z.string().max(300)),
  limit: optional(z.number().int().min(1).max(100)),
});

export const Route = createFileRoute('/_platform/audit/')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('platformAudit', 'auditLogs'),
  component: AuditPage,
});

/** The picked day as the server's date-time: start of that local day, or its last millisecond. */
function dayBound(iso: string | undefined, end: boolean): string | undefined {
  const m = iso && /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  return (end ? new Date(y, mo, d, 23, 59, 59, 999) : new Date(y, mo, d)).toISOString();
}

function AuditPage() {
  const { t } = useTranslation('platformAudit');
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const tab = search.tab ?? 'all';
  const { cursor, limit } = search;

  const filters: AuditFilterValues = {
    tenantId: search.tenantId,
    action: search.action,
    actorId: search.actorId,
    sessionId: search.sessionId,
    from: search.from,
    to: search.to,
  };
  const set = (patch: AuditFilterValues & { tab?: 'all' | 'visits' | undefined }) =>
    void navigate({ search: (prev) => ({ ...prev, cursor: undefined, ...patch }), replace: true });

  const paging = { ...(cursor ? { cursor } : {}), ...(limit ? { limit } : {}) };
  const from = dayBound(filters.from, false);
  const to = dayBound(filters.to, true);
  const audit = usePlatformAudit({
    ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.sessionId ? { sessionId: filters.sessionId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...paging,
  });
  const visits = usePlatformAuditSessions({
    ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
    ...paging,
  });
  const active = tab === 'all' ? audit : visits;
  const nextCursor = active.data?.nextCursor ?? null;
  const error = active.isError ? t('loadError') : undefined;

  return (
    <PageContainer>
      <PageHeader title={t('title')} subtitle={t('caption')} />
      <Tabs
        value={tab}
        onValueChange={(value) => set({ tab: value === 'visits' ? 'visits' : undefined, tenantId: undefined })}
      >
        <TabsList variant="line" aria-label={t('tabsLabel')}>
          <TabsTrigger value="all">{t('tabs.all')}</TabsTrigger>
          <TabsTrigger value="visits">{t('tabs.visits')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'all' ? (
        <>
          <AuditFilters value={filters} onChange={set} />
          <AuditTable
            rows={audit.data?.items ?? []}
            loading={audit.isLoading}
            isFetching={audit.isFetching}
            {...(error ? { error } : {})}
          />
        </>
      ) : (
        <LoginAsLog
          rows={visits.data?.items ?? []}
          loading={visits.isLoading}
          isFetching={visits.isFetching}
          {...(error ? { error } : {})}
          onOpen={(id) => set({ tab: undefined, sessionId: id })}
        />
      )}
      <div className="flex gap-2">
        {cursor && (
          <Button variant="outline" onClick={() => set({})}>
            {t('paging.first')}
          </Button>
        )}
        {nextCursor && (
          <Button
            variant="outline"
            onClick={() => void navigate({ search: (p) => ({ ...p, cursor: nextCursor }) })}
          >
            {t('paging.next')}
          </Button>
        )}
      </div>
    </PageContainer>
  );
}
