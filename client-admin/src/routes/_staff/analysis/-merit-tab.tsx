/**
 * [26.5.1] Merit list tab — `ResultsPanel`'s table styling via `DataTable`
 * (which already renders a phone card list below 768px, [8.14.7]), plus a
 * Print button and a CSV link. Shows the section position column only
 * when a section is selected; otherwise the class-wide position.
 */
import {
  Button,
  DataTable,
  ErrorState,
  Skeleton,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { analysisCsvUrl, useMeritList, type MeritRow } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Printer } from 'lucide-react';

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
  const meritQuery = useMeritList(examId, sectionId);
  const rows = meritQuery.data?.rows ?? [];

  if (meritQuery.isLoading) return <Skeleton className="h-32 w-full" />;
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
      accessorFn: (row) => (sectionId ? (row.section_position ?? '—') : (row.position ?? '—')),
      card: 'title',
    },
    {
      id: 'student',
      header: t('analysis.merit.columnStudent'),
      accessorFn: (row) => `${row.roll_number} · ${row.full_name}`,
    },
    ...(!sectionId
      ? [
          {
            id: 'section',
            header: t('analysis.merit.columnSection'),
            accessorFn: (row: MeritRow) => row.section_name ?? '—',
          } satisfies DataTableColumn<MeritRow>,
        ]
      : []),
    {
      id: 'total',
      header: t('analysis.merit.columnTotal'),
      accessorFn: (row) => row.total_marks,
      align: 'end',
    },
    {
      id: 'gpa',
      header: t('analysis.merit.columnGpa'),
      accessorFn: (row) => row.gpa.toFixed(2),
      align: 'end',
    },
    { id: 'grade', header: t('analysis.merit.columnGrade'), accessorFn: (row) => row.grade },
    {
      id: 'status',
      header: t('analysis.merit.columnStatus'),
      accessorFn: (row) => (row.is_fail ? t('analysis.merit.fail') : t('analysis.merit.pass')),
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
      <div className="flex justify-end gap-2 print:hidden">
        <Button type="button" variant="outline" onClick={() => window.print()}>
          <Printer className="size-4" />
          {t('analysis.print')}
        </Button>
        <Button type="button" variant="outline" asChild>
          <a href={analysisCsvUrl(examId, 'merit', sectionId)}>{t('analysis.downloadCsv')}</a>
        </Button>
      </div>
      <DataTable
        tableId="analysis-merit"
        caption={t('analysis.tabs.merit')}
        columns={columns}
        data={rows}
        getRowId={(row) => row.student_id}
        sorting={null}
        onSortingChange={() => undefined}
        page={1}
        pageSize={Math.max(1, rows.length)}
        totalCount={rows.length}
        onPageChange={() => undefined}
        emptyMessage={t('resultsPanel.empty')}
      />
    </div>
  );
}
