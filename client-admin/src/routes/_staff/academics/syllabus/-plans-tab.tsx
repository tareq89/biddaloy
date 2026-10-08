/**
 * [66.3.g1-01] Syllabus › Study plans tab: the plan list, most behind first.
 * Built from the parts ListShell uses (FilterBar + DataTable) because a tab
 * panel cannot carry a second page header. `usePlansHeader` gives the page
 * header its subtitle and "Progress CSV" action from the same URL state.
 */
import {
  DataTable,
  ConfirmDialog,
  ErrorState,
  NoticeBar,
  ProgressBar,
  StatusBadge,
  type DataTableColumn,
  type RowAction,
} from '@biddaloy/ui/components';
import {
  downloadStudyPlanLessonsCsv,
  downloadStudyPlanProgressCsv,
  useAcademicYears,
  useActiveRole,
  useActiveTenant,
  useClasses,
  useDeleteStudyPlan,
  useSchoolSettings,
  useStudyPlans,
  useSubjects,
  useTerms,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import {
  FilterBar,
  PageHeader,
  useListShellState,
  type FilterFieldDescriptor,
  type PageAction,
} from '@biddaloy/ui/shells';
import { formatDate, formatNumber, toIsoDate } from '@biddaloy/ui/utils';
import { DownloadIcon, TriangleAlertIcon } from 'lucide-react';
import * as React from 'react';

import { subjectName } from '../homework/-subject-name';

type PlanRow = NonNullable<ReturnType<typeof useStudyPlans>['data']>['data'][number];

/** Sentinel option value for a year with no terms (D14). */
const WHOLE_YEAR = 'whole-year';
const DEFAULT_ESCALATE_AFTER = 2;
const PRIVILEGED_ROLES = ['ADMIN', 'EXECUTIVE'];
const FILTER_KEYS = ['plan_class', 'plan_subject', 'plan_term', 'behind', 'q'] as const;

// ponytail: the browser's calendar day, not the school's — no shared school-time "today"
// helper exists yet (boundary/no-raw-intl); fix when one lands.
const schoolDay = (value: Date): string => toIsoDate(value);

/** Filters + the term they resolve to, shared by the tab and the page header. */
function usePlansScope() {
  const [state, actions] = useListShellState();
  const years = useAcademicYears();
  const yearList = years.data?.data ?? [];
  const yearId = (yearList.find((y) => y.is_current) ?? yearList[0])?.id;
  const terms = useTerms(yearId).data ?? [];

  const today = schoolDay(new Date());
  const defaultTerm = terms.find((term) => term.start_date <= today && today <= term.end_date);
  // '' = the user picked "Whole year"; absent = use the default term.
  const rawTerm = state.filters.plan_term;
  const termId =
    rawTerm === WHOLE_YEAR
      ? undefined
      : (terms.find((x) => x.id === rawTerm)?.id ?? defaultTerm?.id);
  const term = terms.find((x) => x.id === termId);

  const filters = {
    plan_class: state.filters.plan_class ?? '',
    plan_subject: state.filters.plan_subject ?? '',
    plan_term: termId ?? (terms.length > 0 ? WHOLE_YEAR : ''),
    behind: state.filters.behind ?? '',
    q: state.filters.q ?? '',
  };
  const params = {
    ...(filters.plan_class ? { class_id: filters.plan_class } : {}),
    ...(filters.plan_subject ? { subject_id: filters.plan_subject } : {}),
    ...(termId ? { academic_term_id: termId } : {}),
    ...(filters.q ? { q: filters.q } : {}),
  };
  return { state, actions, terms, term, termId, defaultTermId: defaultTerm?.id, filters, params };
}

/** The page header for the plans tab: subtitle + "Progress CSV". Mounted only on that tab, so the
 * Topics tab makes no plan requests. */
export function PlansPageHeader({ title }: { title: string }) {
  const { subtitle, actions } = usePlansHeader();
  return <PageHeader title={title} subtitle={subtitle} actions={actions} />;
}

function usePlansHeader(): {
  subtitle: string | undefined;
  actions: PageAction[];
} {
  const { t } = useTranslation('studyPlans');
  const role = useActiveRole();
  const { term, termId, filters, params } = usePlansScope();
  const all = useStudyPlans({ ...params, limit: 1 });
  const behind = useStudyPlans({ ...params, behind: true, limit: 1 });

  const subtitle =
    all.data && behind.data
      ? t('list.subtitle', {
          term: term?.name ?? t('list.filters.wholeYear'),
          count: all.data.total,
          behind: behind.data.total,
        })
      : undefined;
  return {
    subtitle,
    actions: PRIVILEGED_ROLES.includes(role ?? '')
      ? [
          {
            id: 'progressCsv',
            label: t('list.progressCsv'),
            icon: <DownloadIcon />,
            priority: 'secondary',
            // The export needs a class and a term (D22).
            disabled: !filters.plan_class || !termId,
            onClick: () =>
              termId &&
              void downloadStudyPlanProgressCsv({
                class_id: filters.plan_class,
                academic_term_id: termId,
              }),
          },
        ]
      : [],
  };
}

export function PlansTab() {
  const { t, i18n } = useTranslation('studyPlans');
  const { t: tCommon } = useTranslation('common');
  const regionConfig = useTenantRegionConfig();
  const role = useActiveRole();
  const schoolId = useActiveTenant();
  const { state, actions, terms, defaultTermId, filters, params } = usePlansScope();
  const classes = useClasses();
  const subjects = useSubjects({ limit: 100 });
  const settings = useSchoolSettings(schoolId ?? '');
  // ponytail: hand-written MaskedTenantSettings (ui/src/hooks) lacks `studyPlans`; narrow here.
  const escalateAfter =
    (settings.data as { studyPlans?: { escalateAfterSchoolDays?: number } } | undefined)?.studyPlans
      ?.escalateAfterSchoolDays ?? DEFAULT_ESCALATE_AFTER;

  const sorting = state.sorting ?? { id: 'behind_periods', desc: true };
  const sortId = ['behind_periods', 'section', 'subject'].find((x) => x === sorting.id);
  const query = useStudyPlans({
    ...params,
    ...(filters.behind ? { behind: true } : {}),
    page: state.page,
    limit: state.limit,
    sort: (sortId ?? 'behind_periods') as 'behind_periods' | 'section' | 'subject',
    order: sorting.desc ? 'desc' : 'asc',
  });
  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;

  const deletePlan = useDeleteStudyPlan();
  const [deleting, setDeleting] = React.useState<PlanRow | null>(null);
  const [deleteFailed, setDeleteFailed] = React.useState(false);
  const canDelete = PRIVILEGED_ROLES.includes(role ?? '');

  const fields: FilterFieldDescriptor[] = [
    {
      kind: 'text',
      key: 'q',
      label: t('list.filters.search'),
      placeholder: t('list.filters.searchPlaceholder'),
      primary: true,
    },
    {
      kind: 'select',
      key: 'plan_class',
      label: t('list.filters.class'),
      allLabel: t('list.filters.all'),
      options: (classes.data?.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    },
    {
      kind: 'select',
      key: 'plan_subject',
      label: t('list.filters.subject'),
      allLabel: t('list.filters.all'),
      options: (subjects.data?.data ?? []).map((s) => ({
        value: s.id,
        label: subjectName(s, i18n.language),
      })),
    },
    {
      kind: 'select',
      key: 'plan_term',
      label: t('list.filters.term'),
      // Clearing the field falls back to the current term; "Whole year" is its own option.
      allLabel: terms.find((x) => x.id === defaultTermId)?.name ?? t('list.filters.wholeYear'),
      options: [
        ...(terms.length > 0 ? [{ value: WHOLE_YEAR, label: t('list.filters.wholeYear') }] : []),
        ...terms.map((x) => ({ value: x.id, label: x.name })),
      ],
    },
    { kind: 'checkbox', key: 'behind', label: t('list.filters.behindOnly') },
  ];

  const now = new Date();
  const today = schoolDay(now);
  const yesterday = schoolDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const lastReported = (value: string | null): string => {
    if (!value) return '—';
    const day = value.includes('T') ? schoolDay(new Date(value)) : value;
    if (day === today) return t('list.today');
    if (day === yesterday) return t('list.yesterday');
    return formatDate(day, regionConfig);
  };

  const rowName = (row: PlanRow) =>
    `${row.section.class_name}-${row.section.name} ${subjectName(row.subject, i18n.language)}`;

  const columns: DataTableColumn<PlanRow>[] = [
    {
      id: 'section',
      header: t('list.columns.section'),
      sortable: true,
      card: 'title',
      accessorFn: (row) => (
        <span className="font-medium">{`${row.section.class_name}-${row.section.name}`}</span>
      ),
    },
    {
      id: 'subject',
      header: t('list.columns.subject'),
      sortable: true,
      card: 'subtitle',
      accessorFn: (row) => subjectName(row.subject, i18n.language),
    },
    {
      id: 'term',
      header: t('list.columns.term'),
      accessorFn: (row) => row.term?.name ?? t('list.filters.wholeYear'),
    },
    {
      id: 'progress',
      header: t('list.columns.progress'),
      accessorFn: (row) => (
        <ProgressBar
          done={row.summary.lessons_done}
          total={row.summary.lessons_total}
          label={t('list.lessonsDone', {
            done: formatNumber(row.summary.lessons_done, regionConfig),
            total: formatNumber(row.summary.lessons_total, regionConfig),
          })}
        />
      ),
    },
    {
      id: 'behind_periods',
      header: t('list.columns.behind'),
      sortable: true,
      card: 'badge',
      accessorFn: ({ summary }) => {
        if (summary.periods_behind <= 0) {
          return <StatusBadge tone="success" label={t('list.onTrack')} />;
        }
        const serious = summary.lessons_behind >= 1;
        return (
          <span className="inline-flex items-center gap-1.5">
            {serious && <TriangleAlertIcon aria-hidden="true" className="text-danger size-4" />}
            <StatusBadge
              tone={serious ? 'danger' : 'warning'}
              label={t('list.behindBy', {
                periods: formatNumber(summary.periods_behind, regionConfig),
                lessons: formatNumber(summary.lessons_behind, regionConfig),
              })}
            />
          </span>
        );
      },
    },
    {
      id: 'reporting',
      header: t('list.columns.reporting'),
      accessorFn: ({ summary }) =>
        summary.unreported_school_days > 0 ? (
          <StatusBadge
            tone={summary.unreported_school_days >= escalateAfter ? 'danger' : 'warning'}
            label={t('list.notReported', {
              count: summary.unreported_school_days,
            })}
          />
        ) : (
          <span className="text-text-secondary">{lastReported(summary.last_reported_at)}</span>
        ),
    },
  ];

  const rowActions = (row: PlanRow): RowAction[] => [
    {
      intent: 'view',
      label: t('list.open', { name: rowName(row) }),
      to: `/academics/study-plans/${row.id}`,
      'data-focus-anchor': row.id,
    },
    {
      intent: 'download',
      label: t('list.download', { name: rowName(row) }),
      onClick: () => void downloadStudyPlanLessonsCsv(row.id),
    },
    {
      intent: 'delete',
      label: t('actions.deletePlan'),
      allowed: canDelete,
      onClick: () => {
        setDeleteFailed(false);
        setDeleting(row);
      },
    },
  ];

  return (
    <section className="space-y-4">
      <FilterBar
        fields={fields}
        values={filters}
        onChange={(patch) => {
          // The "Whole year" option is a URL value, not an API one (D14).
          actions.setFilters({
            ...Object.fromEntries(FILTER_KEYS.map((k) => [k, state.filters[k] ?? null])),
            ...patch,
          });
        }}
        resultCount={total}
      />
      {deleteFailed && <NoticeBar tone="danger">{t('list.deleteFailed')}</NoticeBar>}
      {query.isError ? (
        <ErrorState
          message={t('list.error')}
          retryLabel={tCommon('actions.retry')}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          <DataTable
            tableId="study-plans-list"
            caption={t('list.caption')}
            columns={columns}
            rowActions={rowActions}
            data={rows}
            getRowId={(row) => row.id}
            sorting={sorting}
            onSortingChange={actions.setSorting}
            page={state.page}
            pageSize={state.limit}
            totalCount={total}
            onPageChange={actions.setPage}
            onPageSizeChange={actions.setLimit}
            loading={query.isLoading}
            isFetching={query.isFetching}
            emptyState={{
              title: t('list.emptyTitle'),
              explanation: t('list.emptyExplanation'),
            }}
          />
          {sorting.id === 'behind_periods' && sorting.desc && (
            <p className="text-caption text-text-secondary">{t('list.mostBehindFirst')}</p>
          )}
        </>
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && !deletePlan.isPending && setDeleting(null)}
          title={t('actions.deletePlan')}
          description={t('actions.deleteConfirm', { name: rowName(deleting) })}
          confirmLabel={t('actions.deletePlan')}
          cancelLabel={tCommon('actions.cancel')}
          tone="danger"
          busy={deletePlan.isPending}
          onConfirm={() =>
            deletePlan.mutate(deleting.id, {
              onSuccess: () => setDeleting(null),
              onError: () => {
                setDeleting(null);
                setDeleteFailed(true);
              },
            })
          }
        />
      )}
    </section>
  );
}
