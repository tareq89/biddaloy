import { DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import type { PlatformAuditItem } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';
import type { TFunction } from 'i18next';

/** `ORDER_PLACED` becomes `Order placed`: the label for an action nobody has translated yet. */
export function humanizeAction(action: string): string {
  const text = action.toLowerCase().replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type T = TFunction<readonly ['platformAudit', 'auditLogs']>;

export function actionLabel(t: T, action: string): string {
  return t([`platformAudit:actions.${action}`, `auditLogs:actions.${action}`], {
    defaultValue: humanizeAction(action),
  });
}

/**
 * Who did it. A row made inside a Login as visit reads "Biddaloy support (as Rahim)": the
 * server marks it with `impersonatedByName`, and `actorName` is the person the owner acted as.
 * #3830 builds the same words from the same two fields. The audit row carries no role, so the
 * role the mockup shows is not here.
 */
export function whoLabel(t: T, row: Pick<PlatformAuditItem, 'actorName' | 'impersonatedByName'>) {
  if (row.impersonatedByName) return t('platformAudit:support', { name: row.actorName ?? '-' });
  return row.actorName ?? t('platformAudit:table.platform');
}

export interface AuditTableProps {
  rows: PlatformAuditItem[];
  loading: boolean;
  isFetching: boolean;
  error?: string;
}

export function AuditTable({ rows, loading, isFetching, error }: AuditTableProps) {
  const { t } = useTranslation(['platformAudit', 'auditLogs']);
  const config = useRegionConfig();

  const columns: DataTableColumn<PlatformAuditItem>[] = [
    {
      id: 'who',
      header: t('platformAudit:table.who'),
      accessorFn: (row) => whoLabel(t, row),
      card: 'title',
    },
    {
      id: 'when',
      header: t('platformAudit:table.when'),
      accessorFn: (row) => formatDateTime(row.at, config),
      card: 'field',
    },
    {
      id: 'school',
      header: t('platformAudit:table.school'),
      accessorFn: (row) => row.schoolName,
      card: 'field',
    },
    {
      id: 'action',
      header: t('platformAudit:table.action'),
      accessorFn: (row) => actionLabel(t, row.action),
      card: 'field',
    },
    {
      id: 'what',
      header: t('platformAudit:table.what'),
      accessorFn: (row) => row.entityType,
      card: 'field',
    },
  ];

  return (
    <DataTable
      tableId="platform-audit"
      caption={t('platformAudit:table.caption')}
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      sorting={null}
      onSortingChange={() => {}}
      paginated={false}
      totalCount={rows.length}
      loading={loading}
      isFetching={isFetching}
      {...(error !== undefined ? { error } : {})}
      emptyState={{
        title: t('platformAudit:table.emptyTitle'),
        explanation: t('platformAudit:table.emptyExplanation'),
        kind: 'no-results',
      }}
      announceResults={(shown) => t('platformAudit:table.announceResults', { count: shown })}
    />
  );
}
