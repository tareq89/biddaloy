/**
 * [21.9.1] D12: the substitution log — a date-ranged list of cover /
 * cancellation overlays, filterable by covering teacher, covered-for
 * teacher, or section. Filters are query params so a filtered view is
 * bookmarkable/sharable, same convention every other filtered list route
 * in this codebase follows.
 */
import { Button, EmptyState, Skeleton } from '@biddaloy/ui/components';
import { useClasses, useClassSections, useSubstitutions, useTeachers } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { SubstitutionDialog } from './-substitution-dialog';

const searchSchema = z.object({
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  substitute_teacher_id: z.string().uuid().optional().catch(undefined),
  covered_for_teacher_id: z.string().uuid().optional().catch(undefined),
  section_id: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/routines/substitutions')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('routines', 'common'),
  component: SubstitutionsPage,
});

function SubstitutionsPage() {
  const { t } = useTranslation('routines');
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [classId, setClassId] = React.useState('');

  const teachersQuery = useTeachers({});
  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(classId || undefined);
  const substitutionsQuery = useSubstitutions(search);

  function setFilter(patch: Partial<typeof search>) {
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });
  }

  const teacherName = (id: string) =>
    teachersQuery.data?.data.find((teacher) => teacher.id === id)?.user.full_name ?? id;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('substitutionsPage.title')}</h1>
        <Button type="button" onClick={() => setDialogOpen(true)}>
          {t('substitutionsPage.addAction')}
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t('substitutionsPage.fromLabel')}
          <input
            type="date"
            className="h-9 rounded-md border border-input bg-card px-2.5 text-sm"
            value={search.from ?? ''}
            onChange={(event) => setFilter({ from: event.target.value || undefined })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('substitutionsPage.toLabel')}
          <input
            type="date"
            className="h-9 rounded-md border border-input bg-card px-2.5 text-sm"
            value={search.to ?? ''}
            onChange={(event) => setFilter({ to: event.target.value || undefined })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('substitutionsPage.coveringTeacherLabel')}
          <select
            className="h-9 rounded-md border border-input bg-card px-2.5 text-sm"
            value={search.substitute_teacher_id ?? ''}
            onChange={(event) => setFilter({ substitute_teacher_id: event.target.value || undefined })}
          >
            <option value="">{t('substitutionsPage.anyTeacher')}</option>
            {(teachersQuery.data?.data ?? []).map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.user.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('substitutionsPage.coveredForTeacherLabel')}
          <select
            className="h-9 rounded-md border border-input bg-card px-2.5 text-sm"
            value={search.covered_for_teacher_id ?? ''}
            onChange={(event) => setFilter({ covered_for_teacher_id: event.target.value || undefined })}
          >
            <option value="">{t('substitutionsPage.anyTeacher')}</option>
            {(teachersQuery.data?.data ?? []).map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.user.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t('substitutionsPage.classLabel')}
          <select
            className="h-9 rounded-md border border-input bg-card px-2.5 text-sm"
            value={classId}
            onChange={(event) => {
              setClassId(event.target.value);
              setFilter({ section_id: undefined });
            }}
          >
            <option value="">{t('substitutionsPage.anyClass')}</option>
            {(classesQuery.data?.data ?? []).map((klass) => (
              <option key={klass.id} value={klass.id}>
                {klass.name}
              </option>
            ))}
          </select>
        </label>
        {classId && (
          <label className="flex flex-col gap-1 text-sm">
            {t('substitutionsPage.sectionLabel')}
            <select
              className="h-9 rounded-md border border-input bg-card px-2.5 text-sm"
              value={search.section_id ?? ''}
              onChange={(event) => setFilter({ section_id: event.target.value || undefined })}
            >
              <option value="">{t('substitutionsPage.anySection')}</option>
              {(sectionsQuery.data ?? []).map((section) => (
                <option key={section.id} value={section.id}>
                  {section.section_name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {substitutionsQuery.isPending && (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {!substitutionsQuery.isPending && (substitutionsQuery.data ?? []).length === 0 && (
        <EmptyState
          title={t('substitutionsPage.emptyTitle')}
          explanation={t('substitutionsPage.emptyExplanation')}
          action={{ label: t('substitutionsPage.addAction'), onClick: () => setDialogOpen(true) }}
        />
      )}

      <ul className="flex flex-col gap-2">
        {(substitutionsQuery.data ?? []).map((substitution) => (
          <li
            key={substitution.id}
            className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-card px-4 py-2"
          >
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{substitution.date}</span>
              {substitution.is_cancelled ? (
                <span className="text-destructive">{t('substitutionsPage.cancelledLabel')}</span>
              ) : (
                <span>
                  {t('substitutionsPage.coveredByLabel', {
                    name: substitution.substitute_teacher_id
                      ? teacherName(substitution.substitute_teacher_id)
                      : t('substitutionsPage.unknownTeacher'),
                  })}
                </span>
              )}
            </div>
            {substitution.reason && (
              <p className="text-sm text-muted-foreground">{substitution.reason}</p>
            )}
          </li>
        ))}
      </ul>

      <SubstitutionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onDone={() => void substitutionsQuery.refetch()}
      />
    </div>
  );
}
