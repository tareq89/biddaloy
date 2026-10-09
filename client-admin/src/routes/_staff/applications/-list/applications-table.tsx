/**
 * [52.5.1] One tab's filters + table. Columns and row actions differ per view; `inbox` also owns
 * selection, bulk approve and the D25 focus-after-decision hand-back.
 */
import { ApplicationStatus, ApplicationType } from '@biddaloy/shared';
import {
  Button,
  DataTable,
  ErrorState,
  StatusBadge,
  type DataTableColumn,
  type RowAction,
} from '@biddaloy/ui/components';
import {
  APPLICATION_STATUS_TONE,
  stepLabel,
  useAcademicYears,
  useApplications,
  useClasses,
  type ApplicationFilters,
  type ApplicationListItemDto,
} from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FilterBar, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import * as React from 'react';

import { summarize } from './application-summary';
import { BulkApproveButton, BulkResultCard, type BulkSummary } from './bulk-approve';
import { useFocusAfterDecision } from './use-focus-after-decision';

export type ApplicationsView = 'inbox' | 'mine' | 'all';

const TYPES = Object.values(ApplicationType);
const STATUSES = Object.values(ApplicationStatus);
const FILTER_KEYS = ['q', 'type', 'status', 'class_id', 'from', 'to'] as const;

export function ApplicationsTable({ view, onNew }: { view: ApplicationsView; onNew: () => void }) {
  const { t } = useTranslation('applicationsList');
  const { t: tApp } = useTranslation('applications');
  const config = useTenantRegionConfig();
  const [state, actions] = useListShellState();
  const [result, setResult] = React.useState<BulkSummary | null>(null);
  const isInbox = view === 'inbox';

  const { class_id, q, from, to } = state.filters;
  const type = TYPES.find((v) => v === state.filters.type);
  const status = STATUSES.find((v) => v === state.filters.status);
  const params: ApplicationFilters = {
    view,
    page: state.page,
    limit: state.limit,
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(class_id && view !== 'mine' ? { class_id } : {}),
    ...(q ? { q } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const query = useApplications(params);
  const rows = query.data?.data;

  const ids = React.useMemo(() => rows?.map((r) => r.id), [rows]);
  useFocusAfterDecision(isInbox ? ids : undefined, !query.isFetching && !!rows);

  // Classes of the current year only; hidden on `mine`.
  const years = useAcademicYears();
  const currentYear = years.data?.data.find((y) => y.is_current);
  const classes = useClasses(currentYear ? { academic_year_id: currentYear.id } : {}, {
    enabled: view !== 'mine' && !!currentYear,
  });

  const fields: FilterFieldDescriptor[] = [
    {
      kind: 'text',
      key: 'q',
      label: t('filters.searchLabel'),
      placeholder: t('filters.search'),
      primary: true,
    },
    {
      kind: 'select',
      key: 'type',
      label: t('filters.type'),
      allLabel: t('filters.allTypes'),
      options: TYPES.map((v) => ({ value: v, label: tApp(`types.${v}`) })),
    },
    {
      kind: 'select',
      key: 'status',
      label: t('filters.status'),
      allLabel: t('filters.allStatuses'),
      options: STATUSES.map((v) => ({ value: v, label: tApp(`statuses.${v}`) })),
    },
    ...(view === 'mine'
      ? []
      : [
          {
            kind: 'select' as const,
            key: 'class_id',
            label: t('filters.class'),
            allLabel: t('filters.allClasses'),
            options: (classes.data?.data ?? []).map((c) => ({ value: c.id, label: c.name })),
          },
        ]),
    {
      kind: 'date-range',
      fromKey: 'from',
      toKey: 'to',
      label: t('filters.date'),
      fromLabel: t('filters.from'),
      toLabel: t('filters.to'),
    },
  ];

  // Step label without the "ধাপ" word (the column header already says it).
  const loose = (fn: unknown) => fn as (key: string, options?: Record<string, unknown>) => string;
  const shortT = (key: string, options?: Record<string, unknown>) =>
    key === 'stepOf'
      ? loose(t)('stepShort', { ...options, ns: 'applicationsList' })
      : loose(tApp)(key, options);

  const serialCell = (row: ApplicationListItemDto) => (
    <span className="block">
      <span className="font-medium tabular-nums">{row.serial}</span>
      <span className="block text-caption text-muted-foreground">
        {formatDate(row.created_at, config)}
      </span>
    </span>
  );
  const typeCell = (row: ApplicationListItemDto) => tApp(`types.${row.type}`);
  const subjectCell = (row: ApplicationListItemDto) => {
    const text = summarize(row, tApp as never, config);
    return (
      <span className="block truncate" title={text}>
        {text}
      </span>
    );
  };
  const statusCell = (row: ApplicationListItemDto) => (
    <StatusBadge
      tone={APPLICATION_STATUS_TONE[row.status as ApplicationStatus]}
      label={tApp(`statuses.${row.status}`)}
    />
  );
  const applicantCell = (row: ApplicationListItemDto) => {
    const caption =
      row.subject_kind === 'STUDENT'
        ? [row.subject_class_name, row.subject_section_name, row.subject_roll]
            .filter(Boolean)
            .join(' · ')
        : (row.subject_designation ?? '');
    const text = row.source === 'PAPER' ? t('paper') : caption;
    return (
      <span className="block">
        <span className="font-medium">{row.applicant_name}</span>
        {text && <span className="block text-caption text-muted-foreground">{text}</span>}
      </span>
    );
  };

  const columns: DataTableColumn<ApplicationListItemDto>[] =
    view === 'mine'
      ? [
          { id: 'serial', header: t('columns.serial'), accessorFn: serialCell, card: 'title' },
          { id: 'type', header: t('columns.type'), accessorFn: typeCell, card: 'subtitle' },
          { id: 'forWhom', header: t('columns.forWhom'), accessorFn: (r) => r.subject_name },
          { id: 'subject', header: t('columns.subject'), accessorFn: subjectCell },
          { id: 'status', header: t('columns.status'), accessorFn: statusCell, card: 'badge' },
        ]
      : [
          { id: 'serial', header: t('columns.serial'), accessorFn: serialCell, card: 'title' },
          { id: 'applicant', header: t('columns.applicant'), accessorFn: applicantCell },
          { id: 'type', header: t('columns.type'), accessorFn: typeCell, card: 'subtitle' },
          { id: 'subject', header: t('columns.subject'), accessorFn: subjectCell },
          ...(isInbox
            ? [
                {
                  id: 'step',
                  header: t('columns.step'),
                  accessorFn: (r: ApplicationListItemDto) => stepLabel(r, shortT, config),
                },
              ]
            : []),
          { id: 'status', header: t('columns.status'), accessorFn: statusCell, card: 'badge' },
        ];

  const rowActions = (row: ApplicationListItemDto): RowAction[] => {
    const base = `/applications/${row.id}`;
    const from = isInbox ? '?from=inbox' : '';
    const label = (k: string) => t(`rowActions.${k}`, { serial: row.serial });
    return [
      { intent: 'view', label: label('view'), to: base + from, 'data-focus-anchor': row.id },
      ...(isInbox && row.can.decide
        ? [
            {
              intent: 'approve' as const,
              label: label('approve'),
              to: `${base}?from=inbox&decide=approve`,
            },
            {
              intent: 'reject' as const,
              label: label('reject'),
              to: `${base}?from=inbox&decide=reject`,
            },
          ]
        : []),
    ];
  };

  const filtersActive = FILTER_KEYS.some((k) => !!state.filters[k]);
  const clearFilters = () =>
    actions.setFilters(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
  const emptyState = filtersActive
    ? {
        kind: 'no-results' as const,
        title: t('empty.noResultsTitle'),
        explanation: t('empty.noResultsBody'),
        action: { label: t('empty.clearFilters'), onClick: clearFilters },
      }
    : {
        title: t(`empty.${view}Title`),
        explanation: t(`empty.${view}Body`),
        ...(view === 'mine' ? { action: { label: t('actions.new'), onClick: onNew } } : {}),
      };

  // Only the bar's own keys: `view`/`decided` live in the same bag and must not show as chips.
  const filterValues: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = state.filters[k];
    if (v) filterValues[k] = v;
  }
  const selectedRows = (rows ?? []).filter((r) => state.selectedIds.has(r.id));

  return (
    <section className="space-y-4">
      <FilterBar
        fields={fields}
        values={filterValues}
        onChange={actions.setFilters}
        {...(query.data ? { resultCount: query.data.total } : {})}
      />
      {result && <BulkResultCard summary={result} onClose={() => setResult(null)} />}
      {query.isError ? (
        <ErrorState
          message={t('loadError')}
          retryLabel={t('retry')}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <DataTable
          tableId={`applications-${view}`}
          caption={t(`tabs.${view}`)}
          columns={columns}
          data={rows ?? []}
          getRowId={(row) => row.id}
          rowActions={rowActions}
          sorting={null}
          onSortingChange={() => undefined}
          page={state.page}
          pageSize={state.limit}
          totalCount={query.data?.total ?? 0}
          onPageChange={actions.setPage}
          onPageSizeChange={actions.setLimit}
          loading={query.isLoading}
          loadingMessage={t('loading')}
          isFetching={query.isFetching}
          emptyState={emptyState}
          {...(isInbox
            ? {
                selectedIds: state.selectedIds,
                onSelectedIdsChange: actions.setSelectedIds,
                bulkActions: (
                  <>
                    <BulkApproveButton
                      selectedCount={state.selectedIds.size}
                      rows={selectedRows}
                      onDone={(summary) => {
                        setResult(summary);
                        actions.setSelectedIds(new Set());
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => actions.setSelectedIds(new Set())}
                    >
                      {t('bulk.clear')}
                    </Button>
                  </>
                ),
              }
            : {})}
        />
      )}
    </section>
  );
}
