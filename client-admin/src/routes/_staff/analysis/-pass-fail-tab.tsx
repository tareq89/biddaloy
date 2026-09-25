/**
 * [26.5.1] Pass/fail tab — per-subject table with an overall row, and a
 * "by component" toggle that swaps in the per-component breakdown. No
 * `Switch` primitive exists in `@biddaloy/ui` (see the plan's corrections)
 * — the toggle reuses `Checkbox`, same as `ResultsPanel`'s `failOnly`
 * filter. Grade distribution renders as compact inline chips (plain
 * tokens, not a new component — a handful of `{grade: count}` pairs
 * doesn't warrant one).
 */
import {
  Button,
  Checkbox,
  DataTable,
  ErrorState,
  Skeleton,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  analysisCsvUrl,
  passFailByComponentQueryOptions,
  passFailQueryOptions,
  type ComponentPassFailRow,
  type OverallPassFailRow,
  type SubjectPassFailRow,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';

import type { AnalysisTabProps } from './-merit-tab';

type Row = SubjectPassFailRow | OverallPassFailRow;

function GradeChips({ distribution }: { distribution: Record<string, number> }) {
  const entries = Object.entries(distribution).filter(([, count]) => count > 0);
  if (entries.length === 0) return <>—</>;
  return (
    <span className="flex flex-wrap gap-1">
      {entries.map(([grade, count]) => (
        <span key={grade} className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
          {grade}: {count}
        </span>
      ))}
    </span>
  );
}

export interface PassFailTabProps extends AnalysisTabProps {
  byComponent: boolean;
  onByComponentChange: (next: boolean) => void;
}

export function PassFailTab({
  examId,
  examName,
  sectionId,
  sectionName,
  className,
  byComponent,
  onByComponentChange,
}: PassFailTabProps) {
  const { t } = useTranslation('exams');
  // Only the visible tab's query is enabled — the toggle used to fetch both
  // subject- and component-level pass/fail data on every render regardless
  // of which table was shown (code review finding on #1001).
  const passFailQuery = useQuery({
    ...passFailQueryOptions(examId, sectionId),
    enabled: examId !== undefined && !byComponent,
  });
  const componentQuery = useQuery({
    ...passFailByComponentQueryOptions(examId, sectionId),
    enabled: examId !== undefined && byComponent,
  });

  const activeQuery = byComponent ? componentQuery : passFailQuery;

  if (activeQuery.isLoading) return <Skeleton className="h-32 w-full" />;
  if (activeQuery.isError)
    return (
      <ErrorState
        message={t('resultsPanel.loadError')}
        onRetry={() => void activeQuery.refetch()}
      />
    );

  const subjectColumns: DataTableColumn<Row>[] = [
    {
      id: 'subject',
      header: t('analysis.passFail.columnSubject'),
      accessorFn: (row) => row.subject_name,
      card: 'title',
    },
    {
      id: 'appeared',
      header: t('analysis.passFail.columnAppeared'),
      accessorFn: (row) => row.appeared,
      align: 'end',
    },
    {
      id: 'passed',
      header: t('analysis.passFail.columnPassed'),
      accessorFn: (row) => row.passed,
      align: 'end',
    },
    {
      id: 'failed',
      header: t('analysis.passFail.columnFailed'),
      accessorFn: (row) => row.failed,
      align: 'end',
    },
    {
      id: 'absent',
      header: t('analysis.passFail.columnAbsent'),
      accessorFn: (row) => row.absent,
      align: 'end',
    },
    {
      id: 'pass_pct',
      header: t('analysis.passFail.columnPassPct'),
      accessorFn: (row) => `${row.pass_pct.toFixed(1)}%`,
      align: 'end',
    },
    {
      id: 'highest',
      header: t('analysis.passFail.columnHighest'),
      accessorFn: (row) => row.highest ?? '—',
      align: 'end',
    },
    {
      id: 'average',
      header: t('analysis.passFail.columnAverage'),
      accessorFn: (row) => (row.average !== null ? row.average.toFixed(1) : '—'),
      align: 'end',
    },
    {
      id: 'grades',
      header: t('analysis.merit.columnGrade'),
      accessorFn: (row) => <GradeChips distribution={row.grade_distribution} />,
    },
  ];

  const componentColumns: DataTableColumn<ComponentPassFailRow>[] = [
    {
      id: 'subject',
      header: t('analysis.passFailComponent.columnSubject'),
      accessorFn: (row) => row.subject_name,
      card: 'title',
    },
    {
      id: 'component',
      header: t('analysis.passFailComponent.columnComponent'),
      accessorFn: (row) => row.component_name,
    },
    {
      id: 'appeared',
      header: t('analysis.passFailComponent.columnAppeared'),
      accessorFn: (row) => row.appeared,
      align: 'end',
    },
    {
      id: 'absent',
      header: t('analysis.passFailComponent.columnAbsent'),
      accessorFn: (row) => row.absent,
      align: 'end',
    },
    {
      id: 'below_pass',
      header: t('analysis.passFailComponent.columnBelowPass'),
      accessorFn: (row) => row.below_pass ?? '—',
      align: 'end',
    },
    {
      id: 'highest',
      header: t('analysis.passFailComponent.columnHighest'),
      accessorFn: (row) => row.highest ?? '—',
      align: 'end',
    },
    {
      id: 'average',
      header: t('analysis.passFailComponent.columnAverage'),
      accessorFn: (row) => (row.average !== null ? row.average.toFixed(1) : '—'),
      align: 'end',
    },
  ];

  const subjectRows: Row[] = passFailQuery.data
    ? [...passFailQuery.data.subjects, passFailQuery.data.overall]
    : [];
  const componentRows = componentQuery.data?.rows ?? [];

  return (
    <div id="analysis-print-area" className="flex flex-col gap-3">
      <div className="hidden print:block">
        <h2 className="text-base font-semibold">{examName}</h2>
        <p className="text-sm">
          {className}
          {sectionName ? ` · ${sectionName}` : ''}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={byComponent}
            onCheckedChange={(v) => onByComponentChange(v === true)}
          />
          {t('analysis.byComponent')}
        </label>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" />
            {t('analysis.print')}
          </Button>
          <Button type="button" variant="outline" asChild>
            <a href={analysisCsvUrl(examId, 'pass-fail', sectionId)}>{t('analysis.downloadCsv')}</a>
          </Button>
        </div>
      </div>
      {byComponent ? (
        <DataTable
          tableId="analysis-pass-fail-component"
          caption={t('analysis.tabs.passFail')}
          columns={componentColumns}
          data={componentRows}
          getRowId={(row) => `${row.subject_id}-${row.component_id}`}
          sorting={null}
          onSortingChange={() => undefined}
          page={1}
          pageSize={Math.max(1, componentRows.length)}
          totalCount={componentRows.length}
          onPageChange={() => undefined}
          emptyMessage={t('resultsPanel.empty')}
        />
      ) : (
        <DataTable
          tableId="analysis-pass-fail"
          caption={t('analysis.tabs.passFail')}
          columns={subjectColumns}
          data={subjectRows}
          getRowId={(row) => row.subject_id ?? 'overall'}
          sorting={null}
          onSortingChange={() => undefined}
          page={1}
          pageSize={Math.max(1, subjectRows.length)}
          totalCount={subjectRows.length}
          onPageChange={() => undefined}
          emptyMessage={t('resultsPanel.empty')}
        />
      )}
    </div>
  );
}
