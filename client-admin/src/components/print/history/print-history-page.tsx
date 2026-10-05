/**
 * [32.3.5] Reports › Printables & documents: every print, searchable (D9). A
 * `ListShell` with a filter bar and a table, following `audit-logs/index.tsx`.
 * Rows never carry the data snapshot; "View" opens it (D59). The route (32.4.1)
 * owns `validateSearch` and passes `search` + `onSearchChange` in, so this
 * component imports no route (D60).
 */
import { Permission } from '@biddaloy/shared';
import { StatusBadge, type DataTableColumn, type StatusTone } from '@biddaloy/ui/components';
import {
  printTemplatesQueryOptions,
  useHasPermission,
  usePrintHistory,
  usersQueryOptions,
  type PrintHistoryRow,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDateTime, formatNumber } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { IdCardIcon, PrinterIcon } from 'lucide-react';
import * as React from 'react';

import { HistoryItemDialog } from './history-item-dialog';
import { filterValues, toHistoryFilters, type PrintHistorySearch } from './print-history-filters';
import { ReprintDialog } from './reprint-dialog';
import { RevokeDialog } from './revoke-dialog';

export interface PrintHistoryPageProps {
  search: PrintHistorySearch;
  /** Merges a patch into the URL search; `null` removes a key. */
  onSearchChange: (patch: Record<string, string | number | null>) => void;
  /** Starts an ID-card print; the primary action shows only with `DOCUMENT_PRINT`. */
  onPrintIdCards?: () => void;
}

/** One badge answering "is this card good?": revoked wins, then the print outcome. */
export function rowStatus(
  row: Pick<PrintHistoryRow, 'revoked_at' | 'outcome'>,
  t: (key: string) => string,
): { tone: StatusTone; label: string } {
  if (row.revoked_at) return { tone: 'neutral', label: t('status.REVOKED') };
  if (row.outcome === 'FAILED') return { tone: 'danger', label: t('outcome.FAILED') };
  if (row.outcome === 'PENDING') return { tone: 'warning', label: t('outcome.PENDING') };
  return { tone: 'success', label: t('outcome.OK') };
}

export function PrintHistoryPage({
  search,
  onSearchChange,
  onPrintIdCards,
}: PrintHistoryPageProps) {
  const { t } = useTranslation('printHistory');
  const region = useRegionConfig();
  const canPrint = useHasPermission(Permission.DOCUMENT_PRINT);
  const canRevoke = useHasPermission(Permission.DOCUMENT_REVOKE);
  // ACR rows are confidential: the server hides them without ACR_READ, so don't offer the filter.
  const canReadAcr = useHasPermission(Permission.ACR_READ);

  const historyQuery = usePrintHistory(toHistoryFilters(search));
  // Option lists are conveniences: roles without the permission would get a 403 toast, so skip the call.
  const canReadUsers = useHasPermission(Permission.USER_READ);
  const templatesQuery = useQuery({ ...printTemplatesQueryOptions(), enabled: canPrint });
  const usersQuery = useQuery({ ...usersQueryOptions({ limit: 100 }), enabled: canReadUsers });

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
      id: 'person',
      header: t('columns.person'),
      accessorFn: (row) => <span className="font-medium">{row.subject_label}</span>,
      card: 'title',
    },
    {
      id: 'document',
      header: t('columns.document'),
      accessorFn: (row) => (
        <>
          {row.template_name}
          <span className="block text-caption text-text-secondary">
            {t('versionValue', { version: formatNumber(row.template_version, region) })}
          </span>
        </>
      ),
    },
    {
      id: 'by',
      header: t('columns.by'),
      accessorFn: (row) => row.printed_by_name ?? t('system'),
    },
    {
      id: 'copy',
      header: t('columns.copy'),
      accessorFn: (row) => formatNumber(row.copy_number, region),
      align: 'end',
    },
    {
      id: 'status',
      header: t('columns.status'),
      accessorFn: (row) => {
        const { tone, label } = rowStatus(row, t);
        return <StatusBadge tone={tone} label={label} />;
      },
      card: 'badge',
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
      options: (canReadAcr
        ? (['STUDENT_ID_CARD', 'STAFF_ID_CARD', 'ACR_ASSESSMENT'] as const)
        : (['STUDENT_ID_CARD', 'STAFF_ID_CARD'] as const)
      ).map((k) => ({
        value: k,
        label: t(`kind.${k}`),
      })),
    },
    ...(canPrint
      ? ([
          {
            kind: 'select',
            key: 'template_id',
            label: t('filters.template'),
            allLabel: t('filters.allTemplates'),
            options: (templatesQuery.data ?? []).map((tpl) => ({
              value: tpl.id,
              label: tpl.name,
            })),
          },
        ] as FilterFieldDescriptor[])
      : []),
    ...(canReadUsers
      ? ([
          {
            kind: 'select',
            key: 'printed_by',
            label: t('filters.printedBy'),
            allLabel: t('filters.allUsers'),
            options: (usersQuery.data?.data ?? []).map((u) => ({
              value: u.id,
              label: u.full_name,
            })),
          },
        ] as FilterFieldDescriptor[])
      : []),
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
        subtitle={t('caption')}
        actions={
          canPrint && onPrintIdCards
            ? [
                {
                  id: 'print-id-cards',
                  label: t('printIdCards'),
                  icon: <IdCardIcon aria-hidden className="size-4" />,
                  priority: 'primary' as const,
                  onClick: onPrintIdCards,
                },
              ]
            : []
        }
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
        pageSize={search.limit ?? 25}
        totalCount={historyQuery.data?.total ?? 0}
        onPageChange={(page) => onSearchChange({ page })}
        onPageSizeChange={(limit) => onSearchChange({ limit, page: null })}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={historyQuery.isLoading}
        isFetching={historyQuery.isFetching}
        {...(historyQuery.isError ? { error: t('loadError') } : {})}
        rowActions={(row) => [
          {
            intent: 'view',
            label: t('actions.view'),
            onClick: () => setViewId(row.item_id),
          },
          {
            intent: 'print',
            label: t('actions.reprint'),
            onClick: () => setReprintRow(row),
            allowed: canPrint && !row.revoked_at,
          },
          {
            intent: 'reject',
            label: t('actions.revoke'),
            onClick: () => setRevokeRow(row),
            allowed: canRevoke && !row.revoked_at,
          },
        ]}
        emptyState={{
          title: t('empty'),
          explanation: t('emptyExplanation'),
          icon: <PrinterIcon aria-hidden className="size-5" />,
          ...(canPrint && onPrintIdCards
            ? { action: { label: t('printIdCards'), onClick: onPrintIdCards } }
            : {}),
        }}
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
