/**
 * [32.3.5] Reports › Printables & documents: every print, searchable (D9). A
 * `ListShell` with a filter bar and a table, following `audit-logs/index.tsx`.
 * Rows never carry the data snapshot; "View" opens it (D59). The route (32.4.1)
 * owns `validateSearch` and passes `search` + `onSearchChange` in, so this
 * component imports no route (D60).
 */
import { Permission } from '@biddaloy/shared';
import { Button, type DataTableColumn } from '@biddaloy/ui/components';
import {
  useHasPermission,
  usePrintHistory,
  usePrintTemplates,
  useUsers,
  type PrintHistoryRow,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDateTime } from '@biddaloy/ui/utils';
import * as React from 'react';

import { HistoryItemDialog } from './history-item-dialog';
import { filterValues, toHistoryFilters, type PrintHistorySearch } from './print-history-filters';
import { ReprintDialog } from './reprint-dialog';
import { RevokeDialog } from './revoke-dialog';

export interface PrintHistoryPageProps {
  search: PrintHistorySearch;
  /** Merges a patch into the URL search; `null` removes a key. */
  onSearchChange: (patch: Record<string, string | number | null>) => void;
}

/** A small status pill using the existing status tokens (`StatusBadge` is tied to other domains). */
export function Pill({
  tone,
  children,
}: {
  tone: 'good' | 'bad' | 'neutral';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'good'
      ? 'bg-status-paid-bg text-status-paid-fg'
      : tone === 'bad'
        ? 'bg-status-overdue-bg text-status-overdue-fg'
        : 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

export function PrintHistoryPage({ search, onSearchChange }: PrintHistoryPageProps) {
  const { t } = useTranslation('printHistory');
  const region = useRegionConfig();
  const canPrint = useHasPermission(Permission.DOCUMENT_PRINT);
  const canRevoke = useHasPermission(Permission.DOCUMENT_REVOKE);

  const historyQuery = usePrintHistory(toHistoryFilters(search));
  const templatesQuery = usePrintTemplates();
  const usersQuery = useUsers({ limit: 100 });

  const [viewId, setViewId] = React.useState<string | undefined>(undefined);
  const [reprintRow, setReprintRow] = React.useState<PrintHistoryRow | undefined>(undefined);
  const [revokeRow, setRevokeRow] = React.useState<PrintHistoryRow | undefined>(undefined);

  const rows = historyQuery.data?.data ?? [];

  const columns: DataTableColumn<PrintHistoryRow>[] = [
    {
      id: 'when',
      header: t('columns.when'),
      accessorFn: (row) => formatDateTime(new Date(row.created_at), region),
      card: 'subtitle',
    },
    {
      id: 'by',
      header: t('columns.by'),
      accessorFn: (row) => row.printed_by_name ?? t('system'),
    },
    {
      id: 'document',
      header: t('columns.document'),
      accessorFn: (row) =>
        t('documentValue', { name: row.template_name, version: row.template_version }),
    },
    {
      id: 'person',
      header: t('columns.person'),
      accessorFn: (row) => row.subject_label,
      card: 'title',
    },
    {
      id: 'copy',
      header: t('columns.copy'),
      accessorFn: (row) => t('copyValue', { n: row.copy_number }),
    },
    {
      id: 'result',
      header: t('columns.result'),
      accessorFn: (row) => (
        <Pill tone={row.outcome === 'OK' ? 'good' : row.outcome === 'FAILED' ? 'bad' : 'neutral'}>
          {t(`outcome.${row.outcome}`)}
        </Pill>
      ),
    },
    {
      id: 'status',
      header: t('columns.status'),
      accessorFn: (row) => (
        <Pill tone={row.revoked_at ? 'bad' : 'good'}>
          {row.revoked_at ? t('status.REVOKED') : t('status.VALID')}
        </Pill>
      ),
      card: 'badge',
    },
    {
      id: 'actions',
      header: t('columns.actions'),
      pinned: true,
      card: 'actions',
      accessorFn: (row) => (
        <div className="flex flex-wrap justify-end gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => setViewId(row.item_id)}>
            {t('actions.view')}
            <span className="sr-only"> {row.subject_label}</span>
          </Button>
          {canPrint && !row.revoked_at ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setReprintRow(row)}>
              {t('actions.reprint')}
              <span className="sr-only"> {row.subject_label}</span>
            </Button>
          ) : null}
          {canRevoke && !row.revoked_at ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setRevokeRow(row)}>
              {t('actions.revoke')}
              <span className="sr-only"> {row.subject_label}</span>
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const filterFields: FilterFieldDescriptor[] = [
    {
      kind: 'text',
      key: 'q',
      label: t('filters.search'),
      placeholder: t('filters.searchPlaceholder'),
      primary: true,
    },
    {
      kind: 'select',
      key: 'document_kind',
      label: t('filters.kind'),
      allLabel: t('filters.allKinds'),
      options: (['STUDENT_ID_CARD', 'STAFF_ID_CARD'] as const).map((k) => ({
        value: k,
        label: t(`kind.${k}`),
      })),
    },
    {
      kind: 'select',
      key: 'template_id',
      label: t('filters.template'),
      allLabel: t('filters.allTemplates'),
      options: (templatesQuery.data ?? []).map((tpl) => ({ value: tpl.id, label: tpl.name })),
    },
    {
      kind: 'select',
      key: 'printed_by',
      label: t('filters.printedBy'),
      allLabel: t('filters.allUsers'),
      options: (usersQuery.data?.data ?? []).map((u) => ({ value: u.id, label: u.full_name })),
    },
    {
      kind: 'date-range',
      fromKey: 'from',
      toKey: 'to',
      label: t('filters.dates'),
      fromLabel: t('filters.from'),
      toLabel: t('filters.to'),
    },
    {
      kind: 'select',
      key: 'outcome',
      label: t('filters.outcome'),
      allLabel: t('filters.allOutcomes'),
      options: (['OK', 'FAILED', 'PENDING'] as const).map((o) => ({
        value: o,
        label: t(`outcome.${o}`),
      })),
    },
    {
      kind: 'select',
      key: 'revoked',
      label: t('filters.validity'),
      allLabel: t('filters.allValidity'),
      options: [
        { value: 'false', label: t('filters.onlyValid') },
        { value: 'true', label: t('filters.onlyRevoked') },
      ],
    },
  ];

  return (
    <>
      <ListShell
        title={t('title')}
        filters={{
          fields: filterFields,
          values: filterValues(search),
          // A changed filter starts again from page 1.
          onChange: (patch) => onSearchChange({ ...patch, page: null }),
        }}
        tableId="print-history-list"
        caption={t('caption')}
        columns={columns}
        data={rows}
        getRowId={(row) => row.item_id}
        sorting={null}
        onSortingChange={() => undefined}
        page={search.page ?? 1}
        pageSize={search.limit ?? 10}
        totalCount={historyQuery.data?.total ?? 0}
        onPageChange={(page) => onSearchChange({ page })}
        onPageSizeChange={(limit) => onSearchChange({ limit, page: null })}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={historyQuery.isLoading}
        isFetching={historyQuery.isFetching}
        {...(historyQuery.isError ? { error: t('loadError') } : {})}
        emptyMessage={t('empty')}
        announceResults={(count, total) => t('announce', { visible: count, total })}
      />

      <HistoryItemDialog
        open={viewId !== undefined}
        onOpenChange={(open) => !open && setViewId(undefined)}
        itemId={viewId}
        {...(canPrint
          ? {
              onReprint: (item) => {
                setViewId(undefined);
                setReprintRow(item);
              },
            }
          : {})}
        {...(canRevoke
          ? {
              onRevoke: (item) => {
                setViewId(undefined);
                setRevokeRow(item);
              },
            }
          : {})}
      />
      {reprintRow ? (
        <ReprintDialog
          open
          onOpenChange={(open) => !open && setReprintRow(undefined)}
          row={reprintRow}
        />
      ) : null}
      {revokeRow ? (
        <RevokeDialog
          open
          onOpenChange={(open) => !open && setRevokeRow(undefined)}
          itemId={revokeRow.item_id}
          subjectLabel={revokeRow.subject_label}
        />
      ) : null}
    </>
  );
}
