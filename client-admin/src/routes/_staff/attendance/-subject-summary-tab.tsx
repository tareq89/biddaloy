/**
 * [41.4.5] `/attendance/reports?view=subjects` body — one section's month,
 * attended / held per student per subject (period registers only). The
 * server owns the percentage policy; this only renders it. `null`
 * percentage = nothing held, shown as an em dash, never `0%`.
 */
import { StatusBadge, DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import { useSubjectSummary, type SubjectSummary } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { ChartLine } from 'lucide-react';

type Row = SubjectSummary['rows'][number];

export interface SubjectSummaryTabProps {
  sectionId: string | undefined;
  /** `YYYY-MM` */
  month: string;
  /** Tenant `lowAttendanceThresholdPercent`; no tone while unknown. */
  lowThreshold?: number | undefined;
}

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y ?? 0, m ?? 1, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export function SubjectSummaryTab({ sectionId, month, lowThreshold }: SubjectSummaryTabProps) {
  const { t } = useTranslation('attendance');
  const regionConfig = useRegionConfig();
  const { from, to } = monthRange(month);
  const query = useSubjectSummary(sectionId, from, to);
  const subjects = query.data?.subjects ?? [];

  const subjectColumns: DataTableColumn<Row>[] = subjects.map((subject) => ({
    id: `subject-${subject.subject_id}`,
    header: `${subject.name} (${formatNumber(subject.held, regionConfig)})`,
    accessorFn: (row) => {
      const counts = row.by_subject[subject.subject_id];
      if (!counts) return '—';
      const pct = counts.percentage;
      const low = pct !== null && lowThreshold !== undefined && pct < lowThreshold;
      return (
        <span className="inline-flex flex-col items-end">
          <span>
            {t('reports.subjectCell', {
              attended: formatNumber(counts.attended, regionConfig),
              held: formatNumber(subject.held, regionConfig),
            })}
          </span>
          <span className="text-xs text-muted-foreground">
            {pct === null ? (
              '—'
            ) : (
              <span className="inline-flex items-center gap-1">
                {`${formatNumber(pct, regionConfig)}%`}
                {low && <StatusBadge domain="attendance" status="LOW" />}
              </span>
            )}
          </span>
        </span>
      );
    },
    align: 'end',
  }));

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'roll_number',
      header: t('reports.columnRoll'),
      accessorFn: (row) => formatNumber(row.roll_number, regionConfig),
      card: 'subtitle',
    },
    {
      id: 'full_name',
      header: t('reports.columnStudent'),
      accessorFn: (row) => row.full_name,
      card: 'title',
    },
    ...subjectColumns,
  ];

  const emptyState =
    sectionId === undefined
      ? {
          icon: <ChartLine />,
          title: t('reports.subjectsPickSection'),
          explanation: t('reports.selectSectionPrompt'),
        }
      : { title: t('reports.subjectsEmptyTitle'), explanation: t('reports.emptyMessage') };
  const rows = subjects.length === 0 ? [] : (query.data?.rows ?? []);

  return (
    <DataTable
      tableId="attendance-reports-subjects"
      caption={t('reports.caption')}
      columns={columns}
      data={rows}
      getRowId={(row) => row.student_id}
      rowActions={(row) => [
        {
          intent: 'view' as const,
          label: t('reports.viewStudent'),
          to: `/students/${row.student_id}`,
        },
      ]}
      sorting={null}
      onSortingChange={() => undefined}
      paginated={false}
      page={1}
      pageSize={rows.length || 1}
      totalCount={rows.length}
      onPageChange={() => undefined}
      onPageSizeChange={() => undefined}
      loading={sectionId !== undefined && query.isLoading}
      isFetching={query.isFetching}
      emptyState={emptyState}
      {...(query.isError ? { error: t('reports.errorMessage') } : {})}
      announceResults={(count, total) => t('reports.announceResults', { visible: count, total })}
    />
  );
}
