/**
 * [21.9.1] D12: the substitution log — a date-ranged list of cover /
 * cancellation overlays, filterable by covering teacher, covered-for
 * teacher, or section. Filters are query params so a filtered view is
 * bookmarkable/sharable, same convention every other filtered list route
 * in this codebase follows.
 *
 * [31.4] Each record only carries `routine_slot_id`, so the day / period /
 * class / subject / teachers are joined on the client from the current
 * year's routine (no API change). `class_id` lives in the URL but is never
 * sent to the API — it only narrows the section filter's options.
 */
import { DataTable, ErrorState, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import {
  usePeriodSlotLookup,
  useClasses,
  useClassSections,
  useSectionLookup,
  useSubjects,
  useSubstitutions,
  useTeachers,
  type RoutineSubstitution,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  FilterBar,
  PageContainer,
  PageHeader,
  type FilterFieldDescriptor,
} from '@biddaloy/ui/shells';
import { formatDate, formatNumber, formatTime, formatWeekday } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { subjectName } from './-subject-name';
import { SubstitutionDialog, useCurrentRoutineSlots } from './-substitution-dialog';

const searchSchema = z.object({
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  substitute_teacher_id: z.string().uuid().optional().catch(undefined),
  covered_for_teacher_id: z.string().uuid().optional().catch(undefined),
  class_id: z.string().uuid().optional().catch(undefined),
  section_id: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/routines/substitutions')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('routines', 'common'),
  component: SubstitutionsPage,
});

function SubstitutionsPage() {
  const { t, i18n } = useTranslation('routines');
  const config = useRegionConfig();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [page, setPage] = React.useState(1);

  const { class_id, ...apiFilters } = search;
  const teachersQuery = useTeachers({});
  const classesQuery = useClasses();
  const sectionsQuery = useClassSections(class_id);
  const substitutionsQuery = useSubstitutions(apiFilters);
  const { slotsById } = useCurrentRoutineSlots();
  const sectionLookup = useSectionLookup();
  const periodLookup = usePeriodSlotLookup();
  const subjectsQuery = useSubjects({});

  const teacherName = (id: string | null | undefined) =>
    (id && teachersQuery.data?.data.find((teacher) => teacher.id === id)?.user.full_name) || '—';
  const sectionName = (id: string | undefined) => {
    const entry = id ? sectionLookup.data?.[id] : undefined;
    return entry
      ? t('substitutionsPage.sectionName', {
          className: entry.className,
          sectionName: entry.sectionName,
        })
      : '—';
  };

  const teacherOptions = (teachersQuery.data?.data ?? []).map((teacher) => ({
    value: teacher.id,
    label: teacher.user.full_name,
  }));

  const fields: FilterFieldDescriptor[] = [
    {
      kind: 'date-range',
      fromKey: 'from',
      toKey: 'to',
      label: t('substitutionsPage.dateLabel'),
      fromLabel: t('substitutionsPage.fromLabel'),
      toLabel: t('substitutionsPage.toLabel'),
    },
    {
      kind: 'select',
      key: 'substitute_teacher_id',
      label: t('substitutionsPage.coveringTeacherLabel'),
      allLabel: t('substitutionsPage.anyTeacher'),
      options: teacherOptions,
    },
    {
      kind: 'select',
      key: 'covered_for_teacher_id',
      label: t('substitutionsPage.coveredForTeacherLabel'),
      allLabel: t('substitutionsPage.anyTeacher'),
      options: teacherOptions,
    },
    {
      kind: 'select',
      key: 'class_id',
      label: t('substitutionsPage.classLabel'),
      allLabel: t('substitutionsPage.anyClass'),
      options: (classesQuery.data?.data ?? []).map((klass) => ({
        value: klass.id,
        label: klass.name,
      })),
    },
    {
      kind: 'select',
      key: 'section_id',
      label: t('substitutionsPage.sectionLabel'),
      // ponytail: FilterBar has no disabled select, so before a class is
      // chosen the section filter offers nothing and says why in its own
      // "all" label. Upgrade: a `disabled` flag on SelectFilterField.
      allLabel: class_id
        ? t('substitutionsPage.anySection')
        : t('substitutionsPage.pickClassFirst'),
      options: class_id
        ? (sectionsQuery.data ?? []).map((section) => ({
            value: section.id,
            label: section.section_name,
          }))
        : [],
    },
  ];

  const values: Record<string, string> = Object.fromEntries(
    Object.entries(search).filter(([, value]) => Boolean(value)) as [string, string][],
  );
  const hasFilters = Object.keys(values).length > 0;

  function handleFilterChange(patch: Record<string, string | null>) {
    setPage(1);
    void navigate({
      search: (prev) => ({
        ...prev,
        ...Object.fromEntries(
          Object.entries(patch).map(([key, value]) => [key, value ?? undefined]),
        ),
        // A different class makes the chosen section meaningless.
        ...('class_id' in patch ? { section_id: undefined } : {}),
      }),
    });
  }

  interface Row {
    substitution: RoutineSubstitution;
    sequence: number;
    periodCell: string;
    subject: string;
    section: string;
    absent: string;
  }

  const rows: Row[] = (substitutionsQuery.data ?? []).map((substitution) => {
    const entry = slotsById.get(substitution.routine_slot_id);
    const period = entry ? periodLookup.data?.[entry.slot.period_slot_id] : undefined;
    return {
      substitution,
      sequence: period?.sequence ?? 0,
      periodCell: period
        ? t('substitutionsPage.periodCell', {
            period: t('agenda.periodLabel', { sequence: formatNumber(period.sequence, config) }),
            time: formatTime(period.starts_at, config),
          })
        : '—',
      subject: entry
        ? subjectName(
            subjectsQuery.data?.data.find((subject) => subject.id === entry.slot.subject_id),
            i18n.language,
          )
        : '—',
      section: sectionName(entry?.slot.section_id),
      absent: entry ? entry.teacher_ids.map(teacherName).join(', ') || '—' : '—',
    };
  });
  // Server order is date desc; within a day, period order.
  rows.sort(
    (a, b) => b.substitution.date.localeCompare(a.substitution.date) || a.sequence - b.sequence,
  );
  const pageSize = 25;

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'date',
      header: t('substitutionsPage.columns.date'),
      card: 'title',
      accessorFn: (row) => (
        <>
          <span className="font-medium whitespace-nowrap">
            {formatDate(row.substitution.date, config)}
          </span>
          <span className="block text-caption text-text-secondary">
            {formatWeekday(row.substitution.date, config)}
          </span>
        </>
      ),
    },
    {
      id: 'period',
      header: t('substitutionsPage.columns.period'),
      card: 'subtitle',
      accessorFn: (row) => (
        <>
          {row.periodCell}
          <span className="block text-caption text-text-secondary">{row.subject}</span>
        </>
      ),
    },
    {
      id: 'section',
      header: t('substitutionsPage.columns.section'),
      card: 'field',
      accessorFn: (row) => row.section,
    },
    {
      id: 'absent',
      header: t('substitutionsPage.columns.absent'),
      card: 'field',
      accessorFn: (row) => row.absent,
    },
    {
      id: 'substitute',
      header: t('substitutionsPage.columns.substitute'),
      card: 'field',
      accessorFn: (row) =>
        row.substitution.is_cancelled ? '—' : teacherName(row.substitution.substitute_teacher_id),
    },
    {
      id: 'status',
      header: t('substitutionsPage.columns.status'),
      card: 'badge',
      accessorFn: (row) => (
        <StatusBadge
          tone={row.substitution.is_cancelled ? 'neutral' : 'info'}
          label={
            row.substitution.is_cancelled
              ? t('substitutionsPage.cancelledLabel')
              : t('substitutionsPage.statusCovered')
          }
        />
      ),
    },
    {
      id: 'reason',
      header: t('substitutionsPage.columns.reason'),
      card: 'field',
      accessorFn: (row) => (
        <span className="text-text-secondary">{row.substitution.reason || '—'}</span>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('substitutionsPage.title')}
        subtitle={t('substitutionsPage.subtitle')}
        actions={[
          {
            id: 'add',
            priority: 'primary',
            icon: <PlusIcon />,
            label: t('substitutionsPage.addAction'),
            onClick: () => setDialogOpen(true),
          },
        ]}
      />

      <FilterBar
        fields={fields}
        values={values}
        onChange={handleFilterChange}
        resultCount={rows.length}
      />

      {substitutionsQuery.isError ? (
        <ErrorState
          message={t('substitutionsPage.error')}
          onRetry={() => void substitutionsQuery.refetch()}
        />
      ) : (
        <DataTable
          tableId="routine-substitutions"
          caption={t('substitutionsPage.caption')}
          columns={columns}
          data={rows.slice((page - 1) * pageSize, page * pageSize)}
          getRowId={(row) => row.substitution.id}
          sorting={null}
          onSortingChange={() => {}}
          page={page}
          pageSize={pageSize}
          totalCount={rows.length}
          onPageChange={setPage}
          loading={substitutionsQuery.isPending}
          emptyState={{
            title: t('substitutionsPage.emptyTitle'),
            explanation: t('substitutionsPage.emptyExplanation'),
            ...(hasFilters
              ? {
                  action: {
                    label: t('substitutionsPage.clearFilters'),
                    onClick: () => void navigate({ search: {} }),
                  },
                }
              : {}),
          }}
        />
      )}

      <SubstitutionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onDone={() => void substitutionsQuery.refetch()}
      />
    </PageContainer>
  );
}
