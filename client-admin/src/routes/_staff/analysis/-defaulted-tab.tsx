/**
 * [26.5.1] Defaulters tab — `MeritTab`'s table plus a reasons cell built
 * from `DefaultedRow.failed_subjects`/`absent_subjects`.
 *
 * [31.4.marks-3] No toolbar (Print and CSV are in the page header); reasons
 * on two lines; tenant numerals; a friendly empty state.
 */
import { DataTable, ErrorState, type DataTableColumn } from '@biddaloy/ui/components';
import { useDefaultedList, type DefaultedRow } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CircleCheckIcon } from 'lucide-react';

import type { AnalysisTabProps } from './-merit-tab';

export function DefaultedTab({
  examId,
  examName,
  sectionId,
  sectionName,
  className,
}: AnalysisTabProps) {
  const { t } = useTranslation('exams');
  const { t: tg } = useTranslation('grading');
  const config = useRegionConfig();
  const defaultedQuery = useDefaultedList(examId, sectionId);
  const rows = defaultedQuery.data?.rows ?? [];

  if (defaultedQuery.isError)
    return (
      <ErrorState
        message={t('resultsPanel.loadError')}
        onRetry={() => void defaultedQuery.refetch()}
      />
    );

  const columns: DataTableColumn<DefaultedRow>[] = [
    {
      id: 'roll',
      header: tg('analysisPage.columnRoll'),
      accessorFn: (row) => formatNumber(row.roll_number, config),
      align: 'end',
      card: 'subtitle',
    },
    {
      id: 'name',
      header: tg('analysisPage.columnName'),
      accessorFn: (row) => <span className="font-medium">{row.full_name}</span>,
      card: 'title',
    },
    ...(!sectionId
      ? [
          {
            id: 'section',
            header: t('analysis.defaulted.columnSection'),
            accessorFn: (row: DefaultedRow) =>
              row.section_name ? tg('marksEntry.sectionValue', { name: row.section_name }) : '—',
            card: 'subtitle',
          } satisfies DataTableColumn<DefaultedRow>,
        ]
      : []),
    {
      id: 'reasons',
      header: t('analysis.defaulted.columnReasons'),
      accessorFn: (row) => (
        <div className="flex flex-col">
          {row.failed_subjects.length > 0 && (
            <span>
              {tg('analysisPage.reasonFailed', {
                subjects: row.failed_subjects.map((s) => s.name).join(', '),
              })}
            </span>
          )}
          {row.absent_subjects.length > 0 && (
            <span>
              {tg('analysisPage.reasonAbsent', {
                subjects: row.absent_subjects.map((s) => s.name).join(', '),
              })}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'total',
      header: tg('analysisPage.columnTotal'),
      accessorFn: (row) => formatNumber(row.total_marks, config),
      align: 'end',
    },
    {
      id: 'gpa',
      header: t('analysis.defaulted.columnGpa'),
      accessorFn: (row) => formatNumber(row.gpa, config, { decimals: 2 }),
      align: 'end',
    },
    { id: 'grade', header: t('analysis.defaulted.columnGrade'), accessorFn: (row) => row.grade },
  ];

  return (
    <div id="analysis-print-area" className="flex flex-col gap-3">
      <div className="hidden print:block">
        <h2 className="text-base font-semibold">{examName}</h2>
        <p className="text-sm">
          {className}
          {sectionName ? ` · ${sectionName}` : ''}
        </p>
      </div>
      <DataTable
        tableId="analysis-defaulted"
        caption={tg('analysisPage.tabs.defaulted')}
        columns={columns}
        data={rows}
        getRowId={(row) => row.student_id}
        sorting={null}
        onSortingChange={() => undefined}
        totalCount={rows.length}
        paginated={false}
        loading={defaultedQuery.isLoading}
        emptyState={{
          icon: <CircleCheckIcon />,
          title: tg('analysisPage.noDefaultersTitle'),
          explanation: tg('analysisPage.noDefaultersText'),
        }}
      />
    </div>
  );
}
