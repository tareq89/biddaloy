/**
 * [19.8.1] The exam detail's Results tab — per-student rows (total, GPA,
 * grade, position, fail flag), sortable, filterable by fail, with the
 * process/publish/reopen/SMS actions that move an exam through
 * DRAFT -> PROCESSED -> PUBLISHED. Sorting and the fail filter are local
 * (`useResults` already returns the whole class in one call, position-
 * ordered — no pagination to preserve across a sort change, unlike
 * `DataTable`'s server-side model).
 */
import { Button, Checkbox, ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useResults } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

import { ProcessDialog } from '../../results/-process-dialog';
import { PublishDialog, ReopenPreviewDialog } from '../../results/-publish-dialog';
import { SendResultSmsDialog } from '../../results/-send-result-sms-dialog';

export interface ResultsPanelProps {
  examId: string;
  examStatus: string;
}

type SortColumn = 'position' | 'total_marks' | 'gpa' | 'grade' | 'full_name';

export function ResultsPanel({ examId, examStatus }: ResultsPanelProps) {
  const { t } = useTranslation('exams');
  const resultsQuery = useResults(examId);
  const [sortColumn, setSortColumn] = React.useState<SortColumn>('position');
  const [sortDesc, setSortDesc] = React.useState(false);
  const [failOnly, setFailOnly] = React.useState(false);
  const [processOpen, setProcessOpen] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [reopenOpen, setReopenOpen] = React.useState(false);
  const [smsOpen, setSmsOpen] = React.useState(false);

  const rows = resultsQuery.data ?? [];
  const filtered = failOnly ? rows.filter((r) => r.is_fail) : rows;
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortColumn];
    const bv = b[sortColumn];
    let cmp: number;
    if (av === null) cmp = bv === null ? 0 : 1;
    else if (bv === null) cmp = -1;
    else if (typeof av === 'string' || typeof bv === 'string')
      cmp = String(av).localeCompare(String(bv));
    else cmp = av - bv;
    return sortDesc ? -cmp : cmp;
  });

  function toggleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDesc((desc) => !desc);
    } else {
      setSortColumn(column);
      setSortDesc(false);
    }
  }

  function headerButton(column: SortColumn, label: string) {
    return (
      <button
        type="button"
        onClick={() => toggleSort(column)}
        className="flex items-center gap-1 font-medium"
      >
        {label}
      </button>
    );
  }

  function sortAria(column: SortColumn): 'ascending' | 'descending' | 'none' {
    if (sortColumn !== column) return 'none';
    return sortDesc ? 'descending' : 'ascending';
  }

  if (resultsQuery.isLoading) return <Skeleton className="h-32 w-full" />;
  if (resultsQuery.isError)
    return (
      <ErrorState
        message={t('resultsPanel.loadError')}
        onRetry={() => void resultsQuery.refetch()}
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => setProcessOpen(true)}>
          {t('resultsPanel.process')}
        </Button>
        {examStatus === 'PROCESSED' && (
          <Button type="button" onClick={() => setPublishOpen(true)}>
            {t('resultsPanel.publish')}
          </Button>
        )}
        {examStatus === 'PUBLISHED' && (
          <Button type="button" variant="destructive" onClick={() => setReopenOpen(true)}>
            {t('resultsPanel.reopen')}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => setSmsOpen(true)}>
          {t('resultsPanel.sendSms')}
        </Button>

        <label className="ms-auto flex items-center gap-2 text-sm">
          <Checkbox checked={failOnly} onCheckedChange={(v) => setFailOnly(v === true)} />
          {t('resultsPanel.failFilter')}
        </label>
      </div>

      <table className="w-full text-sm">
        <caption className="sr-only">{t('resultsPanel.tableCaption')}</caption>
        <thead>
          <tr className="border-b text-start text-muted-foreground">
            <th className="py-2" aria-sort={sortAria('position')}>
              {headerButton('position', t('resultsPanel.columnPosition'))}
            </th>
            <th className="py-2" aria-sort={sortAria('full_name')}>
              {headerButton('full_name', t('resultsPanel.columnStudent'))}
            </th>
            <th className="py-2" aria-sort={sortAria('total_marks')}>
              {headerButton('total_marks', t('resultsPanel.columnTotal'))}
            </th>
            <th className="py-2" aria-sort={sortAria('gpa')}>
              {headerButton('gpa', t('resultsPanel.columnGpa'))}
            </th>
            <th className="py-2" aria-sort={sortAria('grade')}>
              {headerButton('grade', t('resultsPanel.columnGrade'))}
            </th>
            <th className="py-2">{t('resultsPanel.columnStatus')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.student_id} className="border-b">
              <td className="py-2">{row.position ?? '—'}</td>
              <td className="py-2">
                <Link
                  to="/results/$examId/$studentId"
                  params={{ examId, studentId: row.student_id }}
                  className="font-medium text-primary underline"
                >
                  {row.roll_number} · {row.full_name}
                </Link>
              </td>
              <td className="py-2">{row.total_marks}</td>
              <td className="py-2">{row.gpa.toFixed(2)}</td>
              <td className="py-2">{row.grade}</td>
              <td className="py-2">
                {row.is_fail ? (
                  <span className="text-destructive">{t('resultsPanel.fail')}</span>
                ) : (
                  t('resultsPanel.pass')
                )}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-center text-muted-foreground">
                {t('resultsPanel.empty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <ProcessDialog open={processOpen} onOpenChange={setProcessOpen} examId={examId} />
      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        examId={examId}
        resultCount={rows.length}
      />
      <ReopenPreviewDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        examId={examId}
        resultCount={rows.length}
      />
      <SendResultSmsDialog
        open={smsOpen}
        onOpenChange={setSmsOpen}
        examId={examId}
        examStatus={examStatus}
        resultCount={rows.length}
      />
    </div>
  );
}
