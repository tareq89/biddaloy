import { UserRole } from '@biddaloy/shared';
import {
  usePlatformAttentionHealth,
  usePlatformBackupHealth,
  usePlatformSchoolList,
  type PlatformSchoolSearchItem,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { LoginAsDialog } from '../../../features/cockpit/login-as/login-as-dialog';
import { loadRouteNamespaces } from '../../../route-loaders';

import { BackupHealthTable } from './-backup-health';
import { EngineHealthCard } from './-engine-health';
import { LiveSessionsStrip } from './-live-sessions-strip';
import { SchoolsListView } from './-schools-list-view';

/**
 * The owner's schools list (mockup "Cockpit: Schools list"). Search, filters and sort live in
 * the URL and drive `usePlatformSchoolList` (`GET /platform/schools/search`, 25 rows a page);
 * the live strip above it lists who is signed in to a school right now. Login as on a row opens
 * the shared dialog.
 */
const SORT_KEYS = ['lastActivity', 'students', 'trialEnd', 'name'] as const;

const schoolsSearchSchema = z.object({
  q: z.string().optional().catch(undefined),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional().catch(undefined),
  trial: z.enum(['active', 'expired']).optional().catch(undefined),
  sort: z.enum(SORT_KEYS).optional().catch(undefined),
  page: z.number().int().min(1).optional().catch(undefined),
});

export const Route = createFileRoute('/_platform/schools/')({
  validateSearch: schoolsSearchSchema,
  // `usePlatformSchoolList` has no queryOptions factory to prefetch with; the page fetches on mount.
  // `backup` / `attention`: reused by the health tables below. `loginAs`: the dialog and the
  // strip's role names.
  loader: () => loadRouteNamespaces('platform', 'backup', 'attention', 'schoolsList', 'loginAs'),
  component: SchoolsListPage,
});

function SchoolsListPage() {
  const { t } = useTranslation('platform');
  const navigate = useNavigate({ from: '/schools/' });
  const search = Route.useSearch();
  const schoolsQuery = usePlatformSchoolList({
    ...(search.q ? { q: search.q } : {}),
    ...(search.status ? { status: search.status } : {}),
    ...(search.trial ? { trial: search.trial } : {}),
    ...(search.sort ? { sort: search.sort } : {}),
    ...(search.page ? { page: search.page } : {}),
  });
  const backupHealthQuery = usePlatformBackupHealth();
  const engineHealth = usePlatformAttentionHealth();
  const [loginAsFor, setLoginAsFor] = React.useState<PlatformSchoolSearchItem | null>(null);

  // Any change other than a page change goes back to page 1.
  const setSearch = (patch: Record<string, string | number | null>) =>
    void navigate({
      search: (prev) => {
        const next: Record<string, unknown> = { ...prev };
        if (!('page' in patch)) delete next.page;
        for (const [key, value] of Object.entries(patch)) {
          if (value === null || value === '') delete next[key];
          else next[key] = value;
        }
        return next;
      },
      replace: true,
    });

  return (
    <div className="space-y-6">
      <LiveSessionsStrip />

      <SchoolsListView
        schools={schoolsQuery.data?.items ?? []}
        total={schoolsQuery.data?.total ?? 0}
        loading={schoolsQuery.isLoading}
        isFetching={schoolsQuery.isFetching}
        {...(schoolsQuery.isError ? { error: t('schools.errorMessage') } : {})}
        filters={search}
        onFiltersChange={setSearch}
        page={search.page ?? 1}
        onPageChange={(page) => setSearch({ page })}
        // The server picks the direction for each sort key, so `desc` here is display-only. The
        // header cycle is therefore on -> off: clicking the active column clears the sort.
        sorting={search.sort ? { id: search.sort, desc: false } : null}
        onSortingChange={(sorting) =>
          setSearch({ sort: sorting && sorting.id !== search.sort ? sorting.id : null })
        }
        onNew={() => void navigate({ to: '/schools/new' })}
        onLoginAs={setLoginAsFor}
      />

      {loginAsFor && (
        <LoginAsDialog
          open
          onOpenChange={(open) => !open && setLoginAsFor(null)}
          schoolId={loginAsFor.id}
          schoolName={loginAsFor.name}
          defaultRole={UserRole.ADMIN}
          // The add-admin form lives on the school's page, so Invite admin goes there.
          onInviteAdmin={() => {
            const id = loginAsFor.id;
            setLoginAsFor(null);
            void navigate({ to: '/schools/$schoolId', params: { schoolId: id } });
          }}
        />
      )}

      <EngineHealthCard
        health={engineHealth.data}
        loading={engineHealth.isLoading}
        error={engineHealth.isError}
        onRetry={() => void engineHealth.refetch()}
      />

      <section aria-labelledby="backup-health-title" className="space-y-3">
        <div>
          <h2 id="backup-health-title" className="text-h2">
            {t('backupHealth.title')}
          </h2>
          <p className="mt-0.5 text-text-secondary">{t('backupHealth.caption')}</p>
        </div>
        <BackupHealthTable
          rows={backupHealthQuery.data ?? []}
          loading={backupHealthQuery.isLoading}
          isFetching={backupHealthQuery.isFetching}
          {...(backupHealthQuery.isError ? { error: t('backupHealth.errorMessage') } : {})}
        />
      </section>
    </div>
  );
}
