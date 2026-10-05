/**
 * [19.9.1] Staff results panel on student detail — every exam this
 * student has a result for, published or not, each unpublished one
 * clearly labelled (issue step 4): staff must never mistake an
 * unpublished grade for one a parent can already see. Same
 * `GET /students/:studentId/results` the portal uses
 * (`StudentResultsController`), but staff get `published: false` rows
 * too since the route's own `isGuardianRole` check never fires for them.
 *
 * Mounted as a tab the same way [19.6.1]'s `SubjectChoicesPanel` is
 * (`$studentId.tsx`).
 */
import {
  DataTable,
  ErrorState,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useStudentResults } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { AwardIcon } from 'lucide-react';

export interface ResultsPanelProps {
  studentId: string;
}

export function ResultsPanel({ studentId }: ResultsPanelProps) {
  const { t } = useTranslation('exams');
  // Loads `students` so the `detail.results.*` copy below resolves.
  useTranslation('students');
  const regionConfig = useRegionConfig();
  const resultsQuery = useStudentResults(studentId);

  if (resultsQuery.isPending) return <Skeleton className="h-24 w-full" />;
  if (resultsQuery.isError) {
    return (
      <ErrorState
        message={t('studentResultsPanel.loadError')}
        retryLabel={t('actions.retry', { ns: 'common' })}
        onRetry={() => void resultsQuery.refetch()}
      />
    );
  }

  const rows = resultsQuery.data;
  type Row = (typeof rows)[number];
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'exam',
      header: t('studentResultsPanel.columnExam'),
      accessorFn: (row) => (
        <span className="flex flex-wrap items-center gap-2 font-medium">
          {row.exam_name}
          {row.is_fail && <StatusBadge tone="danger" label={t('studentResultsPanel.failTag')} />}
        </span>
      ),
      card: 'title',
    },
    { id: 'grade', header: t('studentResultsPanel.columnGrade'), accessorFn: (row) => row.grade },
    {
      id: 'gpa',
      header: t('studentResultsPanel.columnGpa'),
      align: 'end',
      accessorFn: (row) => formatNumber(row.gpa, regionConfig, { decimals: 2 }),
    },
    {
      id: 'status',
      header: t('studentResultsPanel.columnStatus'),
      // The one label this panel exists for: staff must never read an
      // unpublished row as something a parent can already see.
      accessorFn: (row) =>
        row.published ? (
          <StatusBadge tone="success" label={t('studentResultsPanel.published')} />
        ) : (
          <StatusBadge tone="warning" label={t('studentResultsPanel.notPublished')} />
        ),
      card: 'badge',
    },
  ];

  return (
    <DataTable
      tableId="student-results"
      caption={t('studentResultsPanel.caption')}
      paginated={false}
      sorting={null}
      onSortingChange={() => {}}
      columns={columns}
      data={rows}
      getRowId={(row) => row.exam_id}
      totalCount={rows.length}
      rowActions={(row) => [
        {
          intent: 'view',
          label: t('detail.results.view', { ns: 'students' }),
          to: `/results/${row.exam_id}/${studentId}`,
        },
      ]}
      emptyState={{
        title: t('studentResultsPanel.empty'),
        explanation: t('detail.results.emptyExplanation', { ns: 'students' }),
        icon: <AwardIcon aria-hidden="true" />,
      }}
    />
  );
}
