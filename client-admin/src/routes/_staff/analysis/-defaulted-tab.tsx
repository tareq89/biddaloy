/**
 * [26.5.1] Defaulters tab — `MeritTab`'s table plus a reasons cell built
 * from `DefaultedRow.failed_subjects`/`absent_subjects`.
 */
import {
  Button,
  DataTable,
  ErrorState,
  Skeleton,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { downloadAnalysisCsv, useDefaultedList, type DefaultedRow } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Printer } from 'lucide-react';
import * as React from 'react';

import type { AnalysisTabProps } from './-merit-tab';

export function DefaultedTab({
  examId,
  examName,
  sectionId,
  sectionName,
  className,
}: AnalysisTabProps) {
  const { t } = useTranslation('exams');
  const defaultedQuery = useDefaultedList(examId, sectionId);
  const rows = defaultedQuery.data?.rows ?? [];

  const [csvBusy, setCsvBusy] = React.useState(false);
  async function handleDownloadCsv() {
    setCsvBusy(true);
    try {
      await downloadAnalysisCsv(examId, 'defaulted', sectionId, examName);
    } catch {
      toast.error(t('analysis.downloadCsvError'));
    } finally {
      setCsvBusy(false);
    }
  }

  if (defaultedQuery.isLoading) return <Skeleton className="h-32 w-full" />;
  if (defaultedQuery.isError)
    return (
      <ErrorState
        message={t('resultsPanel.loadError')}
        onRetry={() => void defaultedQuery.refetch()}
      />
    );

  const columns: DataTableColumn<DefaultedRow>[] = [
    {
      id: 'student',
      header: t('analysis.defaulted.columnStudent'),
      accessorFn: (row) => `${row.roll_number} · ${row.full_name}`,
      card: 'title',
    },
    ...(!sectionId
      ? [
          {
            id: 'section',
            header: t('analysis.defaulted.columnSection'),
            accessorFn: (row: DefaultedRow) => row.section_name ?? '—',
          } satisfies DataTableColumn<DefaultedRow>,
        ]
      : []),
    {
      id: 'reasons',
      header: t('analysis.defaulted.columnReasons'),
      accessorFn: (row) => {
        const parts: string[] = [];
        if (row.failed_subjects.length > 0) {
          parts.push(
            t('analysis.reasons.failed', {
              subjects: row.failed_subjects.map((s) => s.name).join(', '),
            }),
          );
        }
        if (row.absent_subjects.length > 0) {
          parts.push(
            t('analysis.reasons.absent', {
              subjects: row.absent_subjects.map((s) => s.name).join(', '),
            }),
          );
        }
        return parts.join(' · ');
      },
    },
    {
      id: 'total',
      header: t('analysis.defaulted.columnTotal'),
      accessorFn: (row) => row.total_marks,
      align: 'end',
    },
    {
      id: 'gpa',
      header: t('analysis.defaulted.columnGpa'),
      accessorFn: (row) => row.gpa.toFixed(2),
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
      <div className="flex justify-end gap-2 print:hidden">
        <Button type="button" variant="outline" onClick={() => window.print()}>
          <Printer className="size-4" />
          {t('analysis.print')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleDownloadCsv()}
          disabled={csvBusy}
          loading={csvBusy}
        >
          {t('analysis.downloadCsv')}
        </Button>
      </div>
      <DataTable
        tableId="analysis-defaulted"
        caption={t('analysis.tabs.defaulted')}
        columns={columns}
        data={rows}
        getRowId={(row) => row.student_id}
        sorting={null}
        onSortingChange={() => undefined}
        page={1}
        pageSize={Math.max(1, rows.length)}
        totalCount={rows.length}
        onPageChange={() => undefined}
        emptyMessage={t('analysis.empty.noDefaulters')}
      />
    </div>
  );
}
