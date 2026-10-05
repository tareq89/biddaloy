import { usePlatformBackupHealth, useSchools } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { BackupHealthTable } from './-backup-health';
import { SchoolsListView } from './-schools-list-view';

/**
 * #533's SUPER_ADMIN platform schools list — every school (id, name,
 * slug, status, created date), searchable by name/slug. No pagination:
 * `useSchools()` (`ui/src/hooks/school-settings.ts`) already fetches the
 * full unpaginated list for #8.7.13's school picker, and the platform is
 * expected to run a handful of tenants, same "N is always small" call
 * `academic-years/index.tsx` makes for its own year list.
 *
 * Client-side search only (`filteredSchools` below) — there's no
 * server-side filter on `GET /schools` and none is needed at this scale.
 *
 * `-schools-list-view.tsx` carries the actual table markup so it can be
 * storied on its own; this file only wires the live query and navigation.
 */
export const Route = createFileRoute('/_platform/schools/')({
  // No `ensureQueryData` prefetch — `useSchools()`
  // (`ui/src/hooks/school-settings.ts`) has no `queryOptions` factory to
  // share with a loader (it's a plain `useQuery` call, same shape
  // `security.tsx`'s own session list uses), so this route fetches on
  // mount like that one does rather than duplicating the query definition.
  // Still needs a `loader` to preload the `platform` i18n namespace.
  // [14.12.3/#617] `backup` too — `BackupHealthTable`'s "Never" fallback
  // and per-job status labels (`status.DONE`/`FAILED`/...) reuse that
  // namespace rather than duplicating its `status.*` tree here.
  loader: () => loadRouteNamespaces('platform', 'backup'),
  component: SchoolsListPage,
});

function SchoolsListPage() {
  const { t } = useTranslation('platform');
  const navigate = useNavigate();
  const schoolsQuery = useSchools();
  const backupHealthQuery = usePlatformBackupHealth();
  const [search, setSearch] = React.useState('');

  const filteredSchools = React.useMemo(() => {
    const rows = schoolsQuery.data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (school) =>
        school.name.toLowerCase().includes(term) || school.slug.toLowerCase().includes(term),
    );
  }, [schoolsQuery.data, search]);

  return (
    <div className="space-y-6">
      <SchoolsListView
        schools={filteredSchools}
        loading={schoolsQuery.isLoading}
        isFetching={schoolsQuery.isFetching}
        {...(schoolsQuery.isError ? { error: t('schools.errorMessage') } : {})}
        search={search}
        onSearchChange={setSearch}
        onNew={() => void navigate({ to: '/schools/new' })}
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
