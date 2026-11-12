import { DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import type { LoginAsSessionItem } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';

import { humanizeAction } from './-audit-table';

/** Whole minutes between start and end; null while the visit is live or has no start. */
export function visitMinutes(row: Pick<LoginAsSessionItem, 'startedAt' | 'endedAt'>) {
  if (!row.startedAt || !row.endedAt) return null;
  return Math.max(0, Math.round((Date.parse(row.endedAt) - Date.parse(row.startedAt)) / 60_000));
}

export interface LoginAsLogProps {
  rows: LoginAsSessionItem[];
  loading: boolean;
  isFetching: boolean;
  error?: string;
  /** Open one visit: All activity filtered to it. */
  onOpen: (id: string) => void;
}

/** One row per Login as visit: who, school, as whom, reason, length, how much changed. */
export function LoginAsLog({ rows, loading, isFetching, error, onOpen }: LoginAsLogProps) {
  const { t } = useTranslation('platformAudit');
  const config = useRegionConfig();

  const columns: DataTableColumn<LoginAsSessionItem>[] = [
    { id: 'owner', header: t('visits.owner'), accessorFn: (r) => r.ownerName, card: 'title' },
    { id: 'school', header: t('visits.school'), accessorFn: (r) => r.schoolName, card: 'field' },
    {
      id: 'person',
      header: t('visits.person'),
      accessorFn: (r) => `${r.personName}, ${humanizeAction(r.role)}`,
      card: 'field',
    },
    { id: 'reason', header: t('visits.reason'), accessorFn: (r) => r.reason ?? '-', card: 'field' },
    {
      id: 'started',
      header: t('visits.started'),
      accessorFn: (r) => (r.startedAt ? formatDateTime(r.startedAt, config) : '-'),
      card: 'field',
    },
    {
      id: 'length',
      header: t('visits.length'),
      accessorFn: (r) => {
        const m = visitMinutes(r);
        return m === null ? t('visits.live') : t('visits.minutes', { count: m });
      },
      align: 'end',
      card: 'field',
    },
    {
      id: 'changes',
      header: t('visits.changes'),
      accessorFn: (r) => r.changedCount,
      align: 'end',
      card: 'field',
    },
  ];

  return (
    <DataTable
      tableId="platform-audit-visits"
      caption={t('visits.caption')}
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      sorting={null}
      onSortingChange={() => {}}
      paginated={false}
      totalCount={rows.length}
      loading={loading}
      isFetching={isFetching}
      {...(error !== undefined ? { error } : {})}
      emptyState={{
        title: t('visits.emptyTitle'),
        explanation: t('visits.emptyExplanation'),
        kind: 'no-results',
      }}
      rowActions={(r) => [
        {
          intent: 'view',
          label: t('visits.openFor', { name: r.personName }),
          shortLabel: t('visits.open'),
          display: 'text',
          onClick: () => onOpen(r.id),
        },
      ]}
      announceResults={(shown) => t('visits.announceResults', { count: shown })}
    />
  );
}
