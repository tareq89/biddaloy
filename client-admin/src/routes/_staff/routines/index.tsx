/**
 * [21.8.1] `/routines` — pick a class then a section, then jump into that
 * section's grid builder at `/routines/$sectionId`. Cloned two-level
 * class→section picker from `attendance/register.tsx` (same `useClasses`
 * + `useClassSections(classId)` shape) rather than a new "all sections"
 * endpoint — no server ticket in this wave adds one.
 */
import { EmptyState, Skeleton } from '@biddaloy/ui/components';
import { useClasses, useClassSections } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/routines/')({
  loader: () => loadRouteNamespaces('routines', 'common'),
  component: RoutinesListPage,
});

function RoutinesListPage() {
  const { t } = useTranslation('routines');
  const [classId, setClassId] = React.useState<string | undefined>(undefined);

  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(classId);

  const classes = classesQuery.data?.data ?? [];
  const sections = sectionsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">{t('builderList.title')}</h1>
      <label className="flex flex-col gap-1 text-sm">
        {t('builderList.classLabel')}
        <select
          className="h-8 w-full max-w-xs rounded-md border border-input bg-card px-2.5 text-sm"
          value={classId ?? ''}
          onChange={(event) => setClassId(event.target.value || undefined)}
        >
          <option value="">{t('builderList.selectClass')}</option>
          {classes.map((klass) => (
            <option key={klass.id} value={klass.id}>
              {klass.name}
            </option>
          ))}
        </select>
      </label>

      {classesQuery.isPending && <Skeleton className="h-8 w-64" />}

      {classId && sectionsQuery.isPending && (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {classId && !sectionsQuery.isPending && sections.length === 0 && (
        <EmptyState
          title={t('builderList.emptyTitle')}
          explanation={t('builderList.emptyExplanation')}
          action={{ label: t('builderList.pickAnotherClass'), onClick: () => setClassId(undefined) }}
        />
      )}

      {classId && sections.length > 0 && (
        <ul className="flex flex-col gap-2">
          {sections.map((section) => (
            <li key={section.id}>
              <Link
                to="/routines/$sectionId"
                params={{ sectionId: section.id }}
                search={{ classId }}
                className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-border-subtle bg-card px-4 py-2 no-underline hover:bg-muted"
              >
                <span className="font-medium">{section.section_name}</span>
                <span className="text-sm text-muted-foreground">
                  {t('builderList.enrolledCount', { count: section.enrolled_count })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
