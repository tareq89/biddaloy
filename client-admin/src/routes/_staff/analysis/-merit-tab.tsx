/**
 * [26.5.1] Merit list tab — `ResultsPanel`'s table styling via `DataTable`
 * (which already renders a phone card list below 768px, [8.14.7]). Shows the
 * section position column only when a section is selected; otherwise the
 * class-wide position.
 *
 * [31.4.marks-3] Print and CSV live once in the page header (`index.tsx`);
 * this tab keeps only the print area. Numbers use the tenant's numerals and
 * the result is a `StatusBadge`.
 */
import { DataTable, ErrorState, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import { useMeritList, type MeritRow } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { ListXIcon } from 'lucide-react';

export interface AnalysisTabProps {
  examId: string;
  examName: string;
  sectionId: string | undefined;
  sectionName: string | undefined;
  className: string;
}

export function MeritTab({
  examId,
  examName,
  sectionId,
  sectionName,
  className,
}: AnalysisTabProps) {
  const { t } = useTranslation('exams');
  const { t: tg } = useTranslation('grading');
  const config = useRegionConfig();
  const meritQuery = useMeritList(examId, sectionId);
  const rows = meritQuery.data?.rows ?? [];

  if (meritQuery.isError)
    return (
      <ErrorState message={t('resultsPanel.loadError')} onRetry={() => void meritQuery.refetch()} />
    );

  const columns: DataTableColumn<MeritRow>[] = [
    {
      id: 'position',
      header: sectionId
        ? t('analysis.merit.columnSectionPosition')
        : t('analysis.merit.columnPosition'),
      accessorFn: (row) => formatNumber(sectionId ? row.section_position : row.position, config),
      align: 'end',
      card: 'subtitle',
    },
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
            header: t('analysis.merit.columnSection'),
            accessorFn: (row: MeritRow) =>
              row.section_name ? tg('marksEntry.sectionValue', { name: row.section_name }) : '—',
            card: 'subtitle',
          } satisfies DataTableColumn<MeritRow>,
        ]
      : []),
    {
      id: 'total',
      header: tg('analysisPage.columnTotal'),
      accessorFn: (row) => formatNumber(row.total_marks, config),
      align: 'end',
    },
    {
      id: 'gpa',
      header: t('analysis.merit.columnGpa'),
      accessorFn: (row) => formatNumber(row.gpa, config, { decimals: 2 }),
      align: 'end',
    },
    { id: 'grade', header: t('analysis.merit.columnGrade'), accessorFn: (row) => row.grade },
    {
      id: 'result',
      header: tg('analysisPage.columnResult'),
      accessorFn: (row) => (
        <StatusBadge
          tone={row.is_fail ? 'danger' : 'success'}
          label={row.is_fail ? t('analysis.merit.fail') : t('analysis.merit.pass')}
        />
      ),
      card: 'badge',
    },
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
        tableId="analysis-merit"
        caption={tg('analysisPage.tabs.merit')}
        columns={columns}
        data={rows}
        getRowId={(row) => row.student_id}
        sorting={null}
        onSortingChange={() => undefined}
        totalCount={rows.length}
        paginated={false}
        loading={meritQuery.isLoading}
        emptyState={{
          icon: <ListXIcon />,
          title: tg('analysisPage.noRowsTitle'),
          explanation: sectionId
            ? tg('analysisPage.noRowsSectionText')
            : tg('analysisPage.noRowsText'),
        }}
      />
    </div>
  );
}
