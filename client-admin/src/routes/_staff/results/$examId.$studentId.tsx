/**
 * [19.8.1] step 5: the printable report card. One `RESULT_READ` call,
 * `GET /students/:id/results/:examId`, returns the exam name, result,
 * legend and school header, so roles without EXAM_MANAGE or
 * GRADING_SCALE_MANAGE can open it too [#2922].
 */
import {
  ErrorState,
  ReportCard,
  RoutePending,
  Skeleton,
  StatusBadge,
  toast,
  type ReportCardData,
} from '@biddaloy/ui/components';
import { logDocumentPrint, useStudentResultCard } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, PageContainer } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { PrinterIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/results/$examId/$studentId')({
  loader: () => loadRouteNamespaces('exams', 'grading', 'common'),
  pendingComponent: ReportCardPending,
  component: ReportCardPage,
});

function ReportCardPage() {
  const { examId, studentId } = Route.useParams();
  const { t, i18n } = useTranslation('exams');
  const { t: tg } = useTranslation('grading');
  const config = useRegionConfig();
  const [printing, setPrinting] = React.useState(false);
  const cardQuery = useStudentResultCard(studentId, examId);

  async function handlePrint() {
    setPrinting(true);
    try {
      // Log first, print second (D17/D25): no entry, no print.
      await logDocumentPrint(studentId, { document: 'REPORT_CARD', exam_id: examId });
      window.print();
    } catch {
      toast.error(t('reportCard.logError'));
    } finally {
      setPrinting(false);
    }
  }

  if (cardQuery.isPending) {
    return (
      <PageContainer>
        <div aria-busy="true" className="space-y-4">
          <Skeleton className="h-7 w-48" />
          <div className="flex gap-6">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-4 w-24" />
            ))}
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </PageContainer>
    );
  }
  if (cardQuery.isError || !cardQuery.data) {
    return (
      <PageContainer>
        <ErrorState
          message={t('reportCard.loadError')}
          onRetry={() => {
            void cardQuery.refetch();
          }}
        />
      </PageContainer>
    );
  }

  const card = cardQuery.data;
  const data: ReportCardData = {
    exam_name: card.exam_name,
    student: card.student,
    result: card.result,
    subjects: card.subjects,
    legend: card.legend,
  };

  return (
    <>
      <div className="print:hidden">
        <DetailShell
          name={card.student.full_name}
          statusBadge={
            <StatusBadge
              tone={card.result.is_fail ? 'danger' : 'success'}
              label={t(card.result.is_fail ? 'resultsPanel.fail' : 'resultsPanel.pass')}
            />
          }
          facts={[
            { label: t('reportCard.examLabel'), value: card.exam_name },
            {
              label: t('reportCard.rollLabel'),
              value: formatNumber(card.student.roll_number, config),
            },
            {
              label: t('reportCard.gpa'),
              value: tg('resultsPage.gpaValue', {
                gpa: formatNumber(card.result.gpa, config, { decimals: 2 }),
                grade: card.result.grade,
              }),
            },
            {
              label: t('reportCard.position'),
              value: formatNumber(card.result.position, config),
            },
          ]}
          actions={[
            {
              id: 'print',
              label: t('reportCard.print'),
              priority: 'primary',
              icon: <PrinterIcon />,
              busy: printing,
              onClick: () => void handlePrint(),
            },
          ]}
        />
      </div>

      <div className="mt-6 print:mt-0">
        <PageContainer>
          <div className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5 print:rounded-none print:border-0 print:p-0 print:shadow-none">
            <ReportCard
              data={data}
              issuer={card.issuer}
              logoUrl={card.logo_url}
              activeLanguage={i18n.language}
              labels={{
                examLabel: t('reportCard.examLabel'),
                rollLabel: t('reportCard.rollLabel'),
                subject: t('reportCard.subject'),
                obtained: t('reportCard.obtained'),
                grade: t('reportCard.grade'),
                gpa: t('reportCard.gpa'),
                totalMarks: t('reportCard.totalMarks'),
                totalGpa: t('reportCard.totalGpa'),
                overallGrade: t('reportCard.overallGrade'),
                position: t('reportCard.position'),
                positionValue: t('reportCard.positionValue'),
                fail: t('reportCard.fail'),
                fourthSubject: t('reportCard.fourthSubject'),
                absent: t('reportCard.absent'),
                legendTitle: t('reportCard.legendTitle'),
                programs: t('reportCard.programs'),
                progress: t('reportCard.progress'),
                latestMilestone: t('reportCard.latestMilestone'),
                scoreGrade: t('reportCard.scoreGrade'),
              }}
            />
          </div>
        </PageContainer>
      </div>
    </>
  );
}

function ReportCardPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
