/**
 * Progress tab — [19.6.1], the exam detail's DEFAULT tab. A summary card
 * ("87 of 360 marks lists submitted") above the lists still outstanding; each
 * row's pencil opens that section-subject's marks grid
 * (`/marks/$examId/$sectionId/$subjectId`). The server returns only the
 * not-submitted lists, so there is no state filter.
 */
import { DataTable, EmptyState, ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useExamProgress } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { CircleCheck } from 'lucide-react';
import * as React from 'react';

import { subjectLabel } from './subject-label';

export interface ProgressPanelProps {
  examId: string;
  /** Switches the detail page to the Marks breakdown tab. */
  onGoToSetup?: () => void;
}

const PAGE_SIZE = 25;
const CARD = 'rounded-lg border border-border-subtle bg-surface shadow-e1';

export function ProgressPanel({ examId, onGoToSetup }: ProgressPanelProps) {
  const { t, i18n } = useTranslation('exams');
  const config = useRegionConfig();
  const progressQuery = useExamProgress(examId);
  const [page, setPage] = React.useState(1);

  if (progressQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (progressQuery.isError)
    return (
      <ErrorState
        message={t('progressPanel.loadError')}
        onRetry={() => void progressQuery.refetch()}
      />
    );

  const counts = progressQuery.data?.counts ?? { DRAFT: 0, SUBMITTED: 0 };
  const total = counts.DRAFT + counts.SUBMITTED;
  const submitted = counts.SUBMITTED;

  const rows = (progressQuery.data?.outstanding ?? [])
    .map((row) => ({
      ...row,
      subjectName: subjectLabel(
        { name_en: row.subject_name, name_bn: row.subject_name_bn },
        i18n.language,
      ),
    }))
    .sort(
      (a, b) =>
        a.section_name.localeCompare(b.section_name) || a.subjectName.localeCompare(b.subjectName),
    );

  return (
    <div className="flex flex-col gap-4">
      <section className={`${CARD} p-4 md:p-5`}>
        <h2 className="text-h2">{t('progressPanel.title')}</h2>
        <p className="mt-1 text-h3">{t('progressPanel.submittedOf', {
            submitted: formatNumber(submitted, config),
            total: formatNumber(total, config),
          })}</p>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={submitted}
            aria-label={t('progressPanel.title')}
            className="h-full rounded-full bg-primary"
            style={{ width: total > 0 ? `${(submitted / total) * 100}%` : '0%' }}
          />
        </div>
        <p className="mt-2 text-text-secondary">{t('progressPanel.hint')}</p>
      </section>

      {total === 0 ? (
        <EmptyState
          title={t('progressPanel.noListsTitle')}
          explanation={t('progressPanel.noListsText')}
          {...(onGoToSetup
            ? { action: { label: t('progressPanel.goToSetup'), onClick: onGoToSetup } }
            : {})}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<CircleCheck aria-hidden className="size-6" />}
          title={t('progressPanel.allSubmittedTitle')}
          explanation={t('progressPanel.allSubmittedText')}
        />
      ) : (
        <section className={`${CARD} overflow-hidden`}>
          <div className="p-4 md:p-5">
            <h2 className="text-h2">{t('progressPanel.outstandingTitle')}</h2>
            <p className="mt-1 text-text-secondary">{t('progressPanel.outstandingHelp')}</p>
          </div>
          <DataTable
            tableId="exam-progress"
            caption={t('progressPanel.tableCaption')}
            columns={[
              {
                id: 'subject',
                header: t('progressPanel.columnSubject'),
                accessorFn: (row) => row.subjectName,
                card: 'title',
              },
              {
                id: 'section',
                header: t('progressPanel.columnSection'),
                accessorFn: (row) => t('progressPanel.sectionValue', { name: row.section_name }),
                card: 'subtitle',
              },
            ]}
            rowActions={(row) => [
              {
                intent: 'edit',
                label: t('progressPanel.enterMarks'),
                to: `/marks/${examId}/${row.section_id}/${row.subject_id}`,
              },
            ]}
            data={rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
            getRowId={(row) => `${row.section_id}:${row.subject_id}`}
            sorting={null}
            onSortingChange={() => {}}
            page={page}
            pageSize={PAGE_SIZE}
            totalCount={rows.length}
            onPageChange={setPage}
          />
        </section>
      )}
    </div>
  );
}
