import { useSchools } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

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
 * Row click navigates to `/schools/$schoolId`, a placeholder today —
 * #535 (15.4.10) fills in the real detail page. `-schools-list-view.tsx`
 * carries the actual table markup so it can be storied on its own; this
 * file only wires the live query and the router link.
 */
export const Route = createFileRoute('/_platform/schools/')({
  // No `ensureQueryData` prefetch — `useSchools()`
  // (`ui/src/hooks/school-settings.ts`) has no `queryOptions` factory to
  // share with a loader (it's a plain `useQuery` call, same shape
  // `security.tsx`'s own session list uses), so this route fetches on
  // mount like that one does rather than duplicating the query definition.
  // Still needs a `loader` to preload the `platform` i18n namespace.
  loader: () => loadRouteNamespaces('platform'),
  component: SchoolsListPage,
});

function SchoolsListPage() {
  const { t } = useTranslation('platform');
  const schoolsQuery = useSchools();
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
    <SchoolsListView
      schools={filteredSchools}
      loading={schoolsQuery.isLoading}
      isFetching={schoolsQuery.isFetching}
      {...(schoolsQuery.isError ? { error: t('schools.errorMessage') } : {})}
      search={search}
      onSearchChange={setSearch}
      renderName={(school) => (
        <Link
          to="/schools/$schoolId"
          params={{ schoolId: school.id }}
          className="font-medium text-primary underline"
        >
          {school.name}
        </Link>
      )}
    />
  );
}
